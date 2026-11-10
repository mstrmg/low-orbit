// Builds and updates module meshes from the simulation state.
// Module-local frame: +Z runs along the module away from its parent,
// +Y is the facing (for wings), origin is the centre of the module's first cell.
//
// Each module type is modelled once from boxes, cylinders and rings, merged into
// a handful of meshes (one per material), then cloned for every module built.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HEAT } from '../config/balance.js';
import { MODULES } from '../data/modules.js';
import { moduleStatus } from '../sim/state.js';
import { perpendiculars } from '../sim/vec.js';

export const CELL = 2; // scene units per grid cell

const STATUS_COLOR = { ok: 0x6ee7a0, warn: 0xffc24a, overheated: 0xff4b3e, unpowered: 0x7a2a2a };
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export const cellToWorld = (cell, out = new THREE.Vector3()) => out.set(cell[0] * CELL, cell[1] * CELL, cell[2] * CELL);

/** Orientation that takes module-local axes to station axes. */
export function moduleQuaternion(axis, facing, out = new THREE.Quaternion()) {
  const z = new THREE.Vector3(...axis);
  const y = new THREE.Vector3(...(facing ?? perpendiculars(axis)[0]));
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// --- Painted textures (no image files) -------------------------------------------

function paint(size, draw, { repeat = false, srgb = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

// Small deterministic RNG so textures look the same every load.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Solar cells: rows of dark blue cells with thin silver bus lines. */
const solarTexture = () =>
  paint(512, (ctx, s) => {
    const rand = seeded(11);
    ctx.fillStyle = '#0a0f24';
    ctx.fillRect(0, 0, s, s);
    const cols = 8;
    const rows = 4;
    const w = s / cols;
    const h = s / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const shade = 0.85 + rand() * 0.3;
        const gradient = ctx.createLinearGradient(c * w, r * h, (c + 1) * w, (r + 1) * h);
        gradient.addColorStop(0, `rgb(${18 * shade}, ${40 * shade}, ${118 * shade})`);
        gradient.addColorStop(1, `rgb(${12 * shade}, ${24 * shade}, ${84 * shade})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(c * w + 3, r * h + 3, w - 6, h - 6);
        ctx.strokeStyle = 'rgba(150, 185, 255, 0.28)';
        ctx.lineWidth = 1;
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(c * w + 3, r * h + (h * k) / 4);
          ctx.lineTo((c + 1) * w - 3, r * h + (h * k) / 4);
          ctx.stroke();
        }
      }
    }
    ctx.strokeStyle = 'rgba(200, 215, 240, 0.55)';
    ctx.lineWidth = 2;
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * w, 0);
      ctx.lineTo(c * w, s);
      ctx.stroke();
    }
  });

/** Hull plating: off-white panels with seams and the odd darker patch. */
const hullTexture = () =>
  paint(
    512,
    (ctx, s) => {
      const rand = seeded(23);
      ctx.fillStyle = '#e4e7ec';
      ctx.fillRect(0, 0, s, s);
      const cols = 4;
      const rows = 4;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const tone = 222 + Math.floor(rand() * 22);
          ctx.fillStyle = `rgb(${tone}, ${tone + 2}, ${tone + 6})`;
          ctx.fillRect((c * s) / cols, (r * s) / rows, s / cols, s / rows);
        }
      }
      ctx.strokeStyle = 'rgba(70, 80, 100, 0.55)';
      ctx.lineWidth = 3;
      for (let i = 0; i <= cols; i++) {
        ctx.beginPath();
        ctx.moveTo((i * s) / cols, 0);
        ctx.lineTo((i * s) / cols, s);
        ctx.moveTo(0, (i * s) / rows);
        ctx.lineTo(s, (i * s) / rows);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(60, 70, 90, 0.5)';
      for (let i = 0; i < 40; i++) ctx.fillRect(rand() * s, rand() * s, 3, 3);
    },
    { repeat: true },
  );

/** Radiator: white with fine coolant channels. */
const radiatorTexture = () =>
  paint(
    256,
    (ctx, s) => {
      ctx.fillStyle = '#f1f3f6';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(120, 135, 160, 0.38)';
      for (let x = 0; x < s; x += 16) ctx.fillRect(x, 0, 3, s);
      ctx.fillStyle = 'rgba(90, 100, 125, 0.5)';
      ctx.fillRect(0, 0, s, 5);
      ctx.fillRect(0, s - 5, s, 5);
    },
    { repeat: true },
  );

/** Crinkled foil: a rough height map for gold insulation blankets. */
const foilBump = () =>
  paint(
    128,
    (ctx, s) => {
      const rand = seeded(5);
      const cell = 8;
      for (let y = 0; y < s; y += cell) {
        for (let x = 0; x < s; x += cell) {
          const v = Math.floor(90 + rand() * 120);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + cell, y);
          ctx.lineTo(x + (rand() > 0.5 ? cell : 0), y + cell);
          ctx.fill();
          const v2 = Math.floor(90 + rand() * 120);
          ctx.fillStyle = `rgb(${v2},${v2},${v2})`;
          ctx.beginPath();
          ctx.moveTo(x + cell, y + cell);
          ctx.lineTo(x, y + cell);
          ctx.lineTo(x + cell, y);
          ctx.fill();
        }
      }
    },
    { repeat: true, srgb: false },
  );

// --- Materials -------------------------------------------------------------------
// Roles: materials that react to a module's state are cloned per module
// ('body' pulses red on overheat, 'lamp' and 'beacon' switch with power, 'glow' warms on radiators).

let palette = null;
function materials() {
  if (palette) return palette;
  const std = (options) => new THREE.MeshStandardMaterial({ flatShading: true, ...options });
  const hullMap = hullTexture();
  const bump = foilBump();
  palette = {
    hull: std({ color: 0xffffff, map: hullMap, roughness: 0.58, metalness: 0.08 }),
    dark: std({ color: 0x353b47, roughness: 0.5, metalness: 0.5 }),
    metal: std({ color: 0x9aa3b2, roughness: 0.38, metalness: 0.7 }),
    foil: std({ color: 0xe0a93e, roughness: 0.36, metalness: 0.75, bumpMap: bump, bumpScale: 1.4 }),
    hubStripe: std({ color: 0x2f7fe6, roughness: 0.5, metalness: 0.1 }),
    labStripe: std({ color: 0x18b5a4, roughness: 0.5, metalness: 0.1 }),
    pipe: std({ color: 0xe2552b, roughness: 0.4, metalness: 0.5 }),
    cells: new THREE.MeshStandardMaterial({ map: solarTexture(), roughness: 0.25, metalness: 0.3 }),
    kapton: std({ color: 0xb9792a, roughness: 0.42, metalness: 0.6, bumpMap: bump, bumpScale: 0.8 }),
    radiator: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: radiatorTexture(),
      roughness: 0.7,
      metalness: 0.05,
      emissive: 0xff5a1e,
      emissiveIntensity: 0,
    }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x1a1710, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.3 }),
    beacon: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    tip: new THREE.MeshBasicMaterial({ color: 0xffb060 }),
    track: std({ color: 0x14171d, roughness: 0.6, metalness: 0.3 }),
  };
  const roles = { hull: 'body', foil: 'body', kapton: 'body', hubStripe: 'body', labStripe: 'body', radiator: 'glow', lamp: 'lamp', beacon: 'beacon' };
  for (const [name, role] of Object.entries(roles)) palette[name].userData.role = role;
  for (const name of ['lamp', 'beacon', 'tip']) palette[name].userData.noShadow = true;
  return palette;
}

// --- Geometry helpers ------------------------------------------------------------

/** A cylinder lying along local Z from z0 to z1. */
function tube(radius, z0, z1, segments = 14, radiusEnd = radius) {
  const geometry = new THREE.CylinderGeometry(radiusEnd, radius, z1 - z0, segments);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, (z0 + z1) / 2);
  return geometry;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const ring = (radius, thickness, z) => new THREE.TorusGeometry(radius, thickness, 6, 18).translate(0, 0, z);
/** Point a geometry modelled along +Z along another direction. */
const aim = (geometry, dir) => geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z_AXIS, new THREE.Vector3(...dir).normalize()));
/** Turn a geometry around the module's long axis. */
const roll = (geometry, angle) => geometry.rotateZ(angle);

/** Collects pieces by material, then merges each material's pieces into one mesh. */
function sculpt() {
  const pieces = new Map();
  const extras = []; // meshes that must stay separate (animated on their own)
  return {
    add(material, ...geometries) {
      if (!pieces.has(material)) pieces.set(material, []);
      pieces.get(material).push(...geometries);
    },
    extra(mesh) {
      extras.push(mesh);
    },
    build() {
      const mats = materials();
      const group = new THREE.Group();
      for (const [name, list] of pieces) {
        const mesh = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), mats[name]);
        for (const g of list) g.dispose();
        mesh.castShadow = mesh.receiveShadow = !mats[name].userData.noShadow;
        group.add(mesh);
      }
      for (const mesh of extras) group.add(mesh);
      return group;
    },
  };
}

/** The dark docking collar every module has where it joins its parent. */
const collar = (z0, z1) => tube(0.46, z0, z1, 16);

// --- Module models ---------------------------------------------------------------
// Each returns { group, ledAt }. Everything stays inside the module's own cells
// (±1 unit across), so neighbours never clip.

function modelHub() {
  const s = sculpt();
  s.add('hull', tube(0.86, -0.56, 0.56, 16));
  s.add('hull', tube(0.86, 0.56, 0.84, 16, 0.5), tube(0.5, -0.84, -0.56, 16, 0.86));
  s.add('dark', collar(0.84, 1), collar(-1, -0.84));
  for (const dir of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) {
    s.add('hull', aim(tube(0.52, 0.6, 0.88, 16), dir));
    s.add('dark', aim(collar(0.88, 1), dir));
  }
  s.add('hubStripe', tube(0.875, -0.13, 0.13, 16));
  s.add('dark', ring(0.87, 0.03, -0.45), ring(0.87, 0.03, 0.45));
  // windows on the four diagonals, between the side ports
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    for (const z of [-0.3, 0.3]) s.add('lamp', roll(box(0.24, 0.05, 0.16, 0, 0.86, z), angle));
  }
  // a short mast with the station beacon
  s.add('metal', roll(box(0.035, 0.36, 0.035, 0, 1.04, 0), -Math.PI / 4));
  s.add('beacon', roll(new THREE.SphereGeometry(0.07, 8, 6).translate(0, 1.24, 0), -Math.PI / 4));
  return { group: s.build(), ledAt: [-0.63, 0.63, 0.3] };
}

function modelLab(length) {
  const s = sculpt();
  const far = length - 1; // z of the far face
  s.add('dark', collar(-1, -0.86), collar(far - 0.14, far));
  s.add('hull', tube(0.5, -0.86, -0.6, 16, 0.8), tube(0.8, far - 0.4, far - 0.14, 16, 0.5));
  s.add('hull', tube(0.8, -0.6, far - 0.4, 16));
  s.add('labStripe', tube(0.815, -0.42, -0.2, 16));
  s.add('foil', tube(0.82, 0.25, 1.0, 16));
  s.add('dark', ring(0.81, 0.03, 0.2), ring(0.81, 0.03, 1.05), ring(0.81, 0.03, far - 0.45));
  // side ports on the last cell
  const portZ = far - 1;
  for (const dir of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) {
    s.add('hull', aim(tube(0.5, 0.6, 0.88, 16), dir).translate(0, 0, portZ));
    s.add('dark', aim(collar(0.88, 1), dir).translate(0, 0, portZ));
  }
  // portholes along both upper diagonals
  for (const side of [1, -1]) {
    for (const z of [-0.05, 0.55, 1.3]) s.add('lamp', roll(box(0.2, 0.05, 0.2, 0, 0.815, z), (side * Math.PI) / 4));
  }
  // an instrument pallet and antenna on the underside diagonals
  s.add('dark', roll(box(0.42, 0.16, 0.7, 0, 0.86, 1.35), (3 * Math.PI) / 4));
  s.add('metal', roll(box(0.3, 0.1, 0.3, 0, 0.9, 0.62), (-3 * Math.PI) / 4));
  s.add('metal', roll(tube(0.02, 0.5, 0.75, 6).rotateX(-Math.PI / 2).translate(0, 0.4, 0.62), (-3 * Math.PI) / 4));
  return { group: s.build(), ledAt: [0, 0.83, -0.42] };
}

function modelBattery() {
  const s = sculpt();
  s.add('dark', collar(-1, -0.72), collar(0.72, 1));
  s.add('foil', box(1.36, 1.36, 1.34));
  // cage rails along every edge
  for (const [x, y] of [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) s.add('dark', box(0.12, 0.12, 1.46, x, y, 0));
  for (const z of [-0.68, 0.68]) {
    for (const [x, y, w, h] of [[0, 0.7, 1.4, 0.12], [0, -0.7, 1.4, 0.12], [0.7, 0, 0.12, 1.4], [-0.7, 0, 0.12, 1.4]]) s.add('dark', box(w, h, 0.1, x, y, z));
  }
  // charge gauges: a dark track on each long face; the lit bar is added per module
  for (let i = 0; i < 4; i++) s.add('track', roll(box(0.34, 0.03, 1.16, 0, 0.69, 0), (i * Math.PI) / 2));
  const barGeometry = box(0.2, 0.03, 1.06, 0, 0, 0.53);
  const barMaterial = new THREE.MeshBasicMaterial({ color: 0x6ee7a0 });
  barMaterial.userData.role = 'bar';
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group();
    holder.rotation.z = (i * Math.PI) / 2;
    const bar = new THREE.Mesh(barGeometry, barMaterial);
    bar.position.set(0, 0.715, -0.53);
    bar.userData.bar = true;
    holder.add(bar);
    s.extra(holder);
  }
  return { group: s.build(), ledAt: [0.5, 0.71, -0.62] };
}

function modelSolar(length) {
  const s = sculpt();
  const far = length - 1;
  s.add('dark', collar(-1, -0.88), box(0.42, 0.34, 0.36, 0, 0, -0.72), tube(0.13, -0.56, -0.44, 10));
  s.add('metal', tube(0.045, -0.5, far - 0.12, 8).translate(0, -0.04, 0));
  const start = -0.4;
  const count = 6;
  const pitch = (far - 0.1 - start) / count;
  for (let i = 0; i < count; i++) {
    const z = start + pitch * (i + 0.5);
    s.add('kapton', box(1.86, 0.03, pitch - 0.07, 0, 0.035, z));
    s.add('cells', new THREE.PlaneGeometry(1.8, pitch - 0.13).rotateX(-Math.PI / 2).translate(0, 0.052, z));
    s.add('metal', box(1.9, 0.045, 0.035, 0, 0.01, start + pitch * i));
  }
  s.add('metal', box(1.9, 0.05, 0.05, 0, 0.01, far - 0.1));
  for (const x of [0.9, -0.9]) s.add('tip', new THREE.SphereGeometry(0.045, 6, 5).translate(x, 0.03, far - 0.1));
  return { group: s.build(), ledAt: [0, 0.2, -0.72] };
}

function modelRadiator(length) {
  const s = sculpt();
  const far = length - 1;
  s.add('dark', collar(-1, -0.88), box(0.46, 0.34, 0.36, 0, 0, -0.72));
  s.add('metal', tube(0.05, -0.56, far - 0.12, 8));
  for (const x of [0.78, -0.78]) s.add('pipe', tube(0.035, -0.5, far - 0.15, 6).translate(x, 0, 0));
  s.add('pipe', box(1.6, 0.05, 0.05, 0, 0, -0.5));
  const start = -0.42;
  const count = 4;
  const pitch = (far - 0.12 - start) / count;
  for (let i = 0; i < count; i++) {
    const slab = box(1.72, 0.045, pitch - 0.05).rotateX((i % 2 ? 1 : -1) * 0.13); // accordion fold
    s.add('radiator', slab.translate(0, 0, start + pitch * (i + 0.5)));
  }
  s.add('metal', box(1.8, 0.06, 0.05, 0, 0, far - 0.12));
  return { group: s.build(), ledAt: [0, 0.2, -0.72] };
}

const MODELS = { hub: modelHub, lab: modelLab, battery: modelBattery, solar: modelSolar, radiator: modelRadiator };
const prototypes = new Map(); // type -> { group, ledAt }
const ledGeometry = new THREE.SphereGeometry(0.06, 8, 6);

function prototypeFor(type) {
  if (!prototypes.has(type)) prototypes.set(type, MODELS[type](MODULES[type].cells * CELL));
  return prototypes.get(type);
}

/**
 * Build the mesh group for one module type. Returns { group, parts } where
 * parts holds the materials and meshes that change with the module's state.
 */
export function buildModuleMesh(type) {
  const { group: source, ledAt } = prototypeFor(type);
  const group = source.clone(true);
  const parts = { type, bodies: [], lamp: null, beacon: null, glow: null, bars: [], barMaterial: null, materials: [] };
  const clones = new Map();
  group.traverse((object) => {
    if (!object.isMesh) return;
    const role = object.material.userData.role;
    if (!role) return; // plain materials are shared by every module
    if (!clones.has(object.material)) {
      const clone = object.material.clone();
      clone.userData = { ...object.material.userData };
      clones.set(object.material, clone);
      parts.materials.push(clone);
      if (role === 'body') parts.bodies.push(clone);
      else if (role === 'lamp') parts.lamp = clone;
      else if (role === 'beacon') parts.beacon = clone;
      else if (role === 'glow') parts.glow = clone;
      else if (role === 'bar') parts.barMaterial = clone;
    }
    object.material = clones.get(object.material);
    if (object.userData.bar) {
      parts.bars.push(object);
      object.userData.keepMaterial = true;
    }
  });
  parts.led = new THREE.MeshBasicMaterial({ color: STATUS_COLOR.ok });
  parts.materials.push(parts.led);
  const led = new THREE.Mesh(ledGeometry, parts.led);
  led.position.set(...ledAt);
  led.userData.keepMaterial = true;
  group.add(led);
  return { group, parts };
}

/** Corner brackets around a module, for the selection highlight. */
function outlineFor(type) {
  const length = MODULES[type].cells * CELL;
  const half = CELL * 0.5;
  const z0 = -half;
  const z1 = length - half;
  const arm = 0.42;
  const points = [];
  for (const x of [-half, half]) {
    for (const y of [-half, half]) {
      for (const z of [z0, z1]) {
        points.push(x, y, z, x - Math.sign(x) * arm, y, z);
        points.push(x, y, z, x, y - Math.sign(y) * arm, z);
        points.push(x, y, z, x, y, z + (z === z0 ? arm : -arm));
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.95, depthTest: false }),
  );
  lines.renderOrder = 9;
  lines.userData.keepMaterial = true;
  return lines;
}

export function createStationView(root) {
  const entries = new Map(); // module id -> { group, parts, heatMaterial, target, born, outline }
  const raycaster = new THREE.Raycaster();
  let selectedId = null;

  /** Add meshes for new modules, drop meshes of removed ones. Returns bounds for framing. */
  function sync(state, now) {
    const alive = new Set();
    for (const module of state.modules) {
      alive.add(module.id);
      let entry = entries.get(module.id);
      if (!entry) {
        const built = buildModuleMesh(module.type);
        built.group.userData.moduleId = module.id;
        built.group.position.copy(cellToWorld(module.cell));
        built.group.quaternion.copy(moduleQuaternion(module.axis, module.facing));
        entry = {
          ...built,
          heatMaterial: new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, flatShading: true }),
          heatOn: false,
          target: new THREE.Quaternion(),
          born: module.type === 'hub' ? -10 : now,
        };
        entries.set(module.id, entry);
        root.add(entry.group);
      }
      moduleQuaternion(module.axis, module.facing, entry.target);
    }
    for (const [id, entry] of entries) {
      if (alive.has(id)) continue;
      root.remove(entry.group);
      // geometry is shared between modules of a type; only the per-module materials go
      for (const material of entry.parts.materials) material.dispose();
      entry.heatMaterial.dispose();
      if (entry.outline) {
        entry.outline.geometry.dispose();
        entry.outline.material.dispose();
      }
      entries.delete(id);
      if (selectedId === id) selectedId = null;
    }
    return bounds(state);
  }

  function bounds(state) {
    const box3 = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const module of state.modules) {
      const cells = MODULES[module.type].cells;
      box3.expandByPoint(cellToWorld(module.cell, point));
      point.set(...module.axis).multiplyScalar((cells - 1) * CELL).add(cellToWorld(module.cell));
      box3.expandByPoint(point);
    }
    const center = box3.getCenter(new THREE.Vector3());
    return { center, radius: box3.getSize(point).length() / 2 + CELL };
  }

  /** Refresh lights, charge bars, glow and animation from the state. */
  function update(state, now, realDt) {
    const blink = Math.sin(now * 9) > 0;
    // station beacon: a double flash every two seconds
    const beat = now % 2;
    const flash = beat < 0.07 || (beat > 0.22 && beat < 0.29);
    for (const module of state.modules) {
      const entry = entries.get(module.id);
      if (!entry) continue;
      const { group, parts } = entry;
      const status = moduleStatus(module);
      const running = module.powered && !module.overheated;

      group.quaternion.slerp(entry.target, 1 - Math.exp(-realDt * 14));
      const age = Math.min(1, (now - entry.born) / 0.25);
      group.scale.setScalar(0.6 + 0.4 * (1 - (1 - age) ** 3));

      parts.led.color.setHex(STATUS_COLOR[status]);
      if (status === 'overheated' && !blink) parts.led.color.setHex(0x3a0d0a);
      if (parts.lamp) parts.lamp.emissiveIntensity = running ? 2.4 : 0.02;
      if (parts.beacon) parts.beacon.color.setScalar(running && flash ? 6 : 0.02);

      // red pulse when shut down by heat, a faint warm tint when merely hot
      const alarm = status === 'overheated' ? (blink ? 0.55 : 0.16) : status === 'warn' ? 0.05 : 0;
      for (const body of parts.bodies) body.emissive.setRGB(alarm, alarm * 0.1, 0);
      if (parts.glow) {
        const shed = module.heatOut / MODULES.radiator.cooling; // 0..1.5
        const warm = THREE.MathUtils.clamp((module.temp - HEAT.RADIATOR_RATED_TEMP) / 60, 0, 1);
        parts.glow.emissiveIntensity = 0.1 * shed + 0.25 * warm;
      }
      if (parts.bars.length) {
        const fraction = module.charge / MODULES.battery.capacity;
        for (const bar of parts.bars) {
          bar.scale.z = Math.max(0.02, fraction);
        }
        if (fraction > 0.3) parts.barMaterial.color.setRGB(0.2, 1.05, 0.5);
        else if (fraction > 0.1) parts.barMaterial.color.setRGB(1.2, 0.7, 0.12);
        else parts.barMaterial.color.setRGB(1.3, 0.2, 0.14);
      }
    }
    const selected = entries.get(selectedId);
    if (selected?.outline) selected.outline.material.opacity = 0.75 + 0.2 * Math.sin(now * 4);
  }

  function setSelected(id) {
    if (id === selectedId) return;
    const old = entries.get(selectedId);
    if (old?.outline) old.group.remove(old.outline);
    selectedId = id;
    const entry = entries.get(id);
    if (!entry) return;
    entry.outline ??= outlineFor(entry.parts.type);
    entry.group.add(entry.outline);
  }

  /** Module id under a pointer position (normalised device coordinates), or null. */
  function pick(ndc, camera) {
    raycaster.setFromCamera(ndc, camera);
    for (const hit of raycaster.intersectObject(root, true)) {
      if (hit.object.isLineSegments) continue;
      let object = hit.object;
      while (object && object.userData.moduleId === undefined) object = object.parent;
      if (object) return object.userData.moduleId;
    }
    return null;
  }

  return { entries, sync, update, setSelected, pick };
}
