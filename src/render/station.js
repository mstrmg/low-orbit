// Builds and updates module meshes from the simulation state.
// Module-local frame: +Z runs along the module away from its parent,
// +Y is the facing (for wings), origin is the centre of the module's first cell.

import * as THREE from 'three';
import { HEAT } from '../config/balance.js';
import { MODULES } from '../data/modules.js';
import { moduleStatus } from '../sim/state.js';
import { perpendiculars } from '../sim/vec.js';

export const CELL = 2; // scene units per grid cell

const STATUS_COLOR = { ok: 0x6ee7a0, warn: 0xffc24a, overheated: 0xff4b3e, unpowered: 0x7a2a2a };

export const cellToWorld = (cell, out = new THREE.Vector3()) => out.set(cell[0] * CELL, cell[1] * CELL, cell[2] * CELL);

/** Orientation that takes module-local axes to station axes. */
export function moduleQuaternion(axis, facing, out = new THREE.Quaternion()) {
  const z = new THREE.Vector3(...axis);
  const y = new THREE.Vector3(...(facing ?? perpendiculars(axis)[0]));
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function standard(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, flatShading: true, ...extra });
}

function add(group, geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** A cylinder lying along local Z from z0 to z1. */
function tube(radius, z0, z1, segments = 14, radiusEnd = radius) {
  const geometry = new THREE.CylinderGeometry(radiusEnd, radius, z1 - z0, segments);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, (z0 + z1) / 2);
  return geometry;
}

let solarTexture = null;
function solarCellTexture() {
  if (solarTexture) return solarTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#14286e';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(120,160,255,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 128; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
    ctx.stroke();
  }
  solarTexture = new THREE.CanvasTexture(canvas);
  solarTexture.colorSpace = THREE.SRGBColorSpace;
  return solarTexture;
}

/**
 * Build the mesh group for one module type. Returns { group, parts } where
 * parts holds the pieces that change with state (lights, charge bar, glow).
 */
export function buildModuleMesh(type) {
  const group = new THREE.Group();
  const spec = MODULES[type];
  const length = spec.cells * CELL; // the module spans local z from -1 to length - 1
  const far = length - CELL / 2;
  const hull = standard(0xd9dde3);
  const dark = standard(0x4a5160);
  const lamp = new THREE.MeshStandardMaterial({ color: 0x0c1418, emissive: 0x7fe0ff, emissiveIntensity: 0 });
  const led = new THREE.MeshBasicMaterial({ color: STATUS_COLOR.ok });
  const parts = { bodies: [hull], lamp, led, type };
  let ledAt = [0, 0.55, -0.7];

  if (type === 'hub') {
    add(group, new THREE.BoxGeometry(1.25, 1.25, 1.25), hull);
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const collar = add(group, tube(0.46, 0.6, 1.0), dark);
      collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...d));
    }
    for (const [x, z, turn] of [[0.63, 0, 0], [-0.63, 0, 0], [0, 0.63, 1], [0, -0.63, 1]]) {
      const window = add(group, new THREE.BoxGeometry(0.02, 0.14, 0.6), lamp, x, 0.3, z);
      if (turn) window.rotation.y = Math.PI / 2;
    }
    ledAt = [0.5, 0.68, 0.5];
  } else if (type === 'lab') {
    add(group, tube(0.46, -1, -0.9), dark);
    add(group, tube(0.5, -0.9, -0.65, 16, 0.78), hull);
    add(group, tube(0.78, -0.65, far - 0.35, 16), hull);
    add(group, tube(0.78, far - 0.35, far - 0.1, 16, 0.5), hull);
    add(group, tube(0.46, far - 0.1, far), dark);
    parts.bodies.push(standard(0xc9952c, { metalness: 0.5, roughness: 0.4 }));
    add(group, tube(0.8, -0.3, 0.8, 16), parts.bodies[1]);
    for (const d of perpendiculars([0, 0, 1])) {
      const stub = add(group, tube(0.4, 0.7, 1.0), dark, 0, 0, CELL);
      stub.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...d));
    }
    for (const z of [-0.1, 0.4, 0.9, 1.4]) {
      for (const sx of [1, -1]) add(group, new THREE.SphereGeometry(0.1, 8, 6), lamp, 0.57 * sx, 0.57, z);
    }
    ledAt = [0, 0.8, -0.5];
  } else if (type === 'battery') {
    const foil = standard(0xc9952c, { metalness: 0.5, roughness: 0.4 });
    parts.bodies = [foil];
    add(group, tube(0.46, -1, -0.72), dark);
    add(group, new THREE.BoxGeometry(1.45, 1.45, 1.44), foil);
    add(group, tube(0.46, 0.72, 1), dark);
    for (const [x, y] of [[0.73, 0.73], [-0.73, 0.73], [0.73, -0.73], [-0.73, -0.73]]) {
      add(group, new THREE.BoxGeometry(0.12, 0.12, 1.5), dark, x, y, 0);
    }
    // Charge bars on the four long faces; scale.z shows the charge.
    parts.bars = [];
    parts.barMaterial = new THREE.MeshBasicMaterial({ color: 0x6ee7a0 });
    const barGeometry = new THREE.BoxGeometry(0.2, 0.03, 1.1).translate(0, 0, 0.55);
    for (let i = 0; i < 4; i++) {
      const holder = new THREE.Group();
      holder.rotation.z = (i * Math.PI) / 2;
      const bar = new THREE.Mesh(barGeometry, parts.barMaterial);
      bar.position.set(0, 0.74, -0.55);
      holder.add(bar);
      group.add(holder);
      parts.bars.push(bar);
    }
    ledAt = [0.5, 0.75, -0.6];
  } else if (type === 'solar') {
    add(group, tube(0.06, -1, far, 8), dark);
    add(group, new THREE.BoxGeometry(0.34, 0.3, 0.4), dark, 0, 0, -0.8);
    const cells = standard(0xffffff, { map: solarCellTexture(), metalness: 0.4, roughness: 0.3, flatShading: false });
    const back = standard(0x8a8f99);
    const count = 5;
    const pitch = (length - 0.4) / count;
    for (let i = 0; i < count; i++) {
      // Box material order: +x, -x, +y (cells), -y (back), +z, -z.
      add(group, new THREE.BoxGeometry(1.8, 0.04, pitch - 0.1), [back, back, cells, back, back, back], 0, 0.07, -0.55 + pitch * (i + 0.5));
    }
    parts.bodies = [back, cells];
    ledAt = [0, 0.2, -0.8];
  } else if (type === 'radiator') {
    add(group, tube(0.07, -1, far - 0.1, 8), dark);
    add(group, new THREE.BoxGeometry(0.4, 0.3, 0.36), dark, 0, 0, -0.8);
    const panel = standard(0xf2f4f7, { roughness: 0.75, emissive: 0xff5a1e, emissiveIntensity: 0, side: THREE.DoubleSide });
    parts.bodies = [panel];
    parts.glow = panel;
    const count = 4;
    const pitch = (length - 0.5) / count;
    for (let i = 0; i < count; i++) {
      const slab = add(group, new THREE.BoxGeometry(1.7, 0.05, pitch - 0.06), panel, 0, 0, -0.55 + pitch * (i + 0.5));
      slab.rotation.x = (i % 2 ? 1 : -1) * 0.14; // accordion fold
    }
    ledAt = [0, 0.2, -0.8];
  }

  const ledMesh = add(group, new THREE.SphereGeometry(0.07, 8, 6), led, ...ledAt);
  ledMesh.castShadow = false;
  ledMesh.userData.keepMaterial = true;
  return { group, parts };
}

/** Local-space box around a module, for the selection outline. */
function outlineFor(type) {
  const length = MODULES[type].cells * CELL;
  const box = new THREE.BoxGeometry(CELL * 0.98, CELL * 0.98, length - 0.04);
  box.translate(0, 0, length / 2 - CELL / 2);
  const lines = new THREE.LineSegments(
    new THREE.EdgesGeometry(box),
    new THREE.LineBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.9 }),
  );
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
          heatMaterial: new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }),
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
      entry.group.traverse((o) => o.geometry?.dispose());
      entries.delete(id);
      if (selectedId === id) selectedId = null;
    }
    return bounds(state);
  }

  function bounds(state) {
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const module of state.modules) {
      const cells = MODULES[module.type].cells;
      box.expandByPoint(cellToWorld(module.cell, point));
      point.set(...module.axis).multiplyScalar((cells - 1) * CELL).add(cellToWorld(module.cell));
      box.expandByPoint(point);
    }
    const center = box.getCenter(new THREE.Vector3());
    return { center, radius: box.getSize(point).length() / 2 + CELL };
  }

  /** Refresh lights, charge bars, glow and animation from the state. */
  function update(state, now, realDt) {
    const blink = Math.sin(now * 9) > 0;
    for (const module of state.modules) {
      const entry = entries.get(module.id);
      if (!entry) continue;
      const { group, parts } = entry;
      const status = moduleStatus(module);

      group.quaternion.slerp(entry.target, 1 - Math.exp(-realDt * 14));
      const age = Math.min(1, (now - entry.born) / 0.25);
      group.scale.setScalar(0.6 + 0.4 * (1 - (1 - age) ** 3));

      parts.led.color.setHex(STATUS_COLOR[status]);
      if (status === 'overheated' && !blink) parts.led.color.setHex(0x3a0d0a);
      parts.lamp.emissiveIntensity = module.powered && !module.overheated ? 1.6 : 0.03;

      const alarm = status === 'overheated' ? (blink ? 0.5 : 0.15) : 0;
      for (const body of parts.bodies) {
        if (body === parts.glow) continue;
        body.emissive.setRGB(alarm, alarm * 0.08, 0);
      }
      if (parts.glow) {
        const shed = module.heatOut / MODULES.radiator.cooling; // 0..1.5
        const warm = THREE.MathUtils.clamp((module.temp - HEAT.RADIATOR_RATED_TEMP) / 60, 0, 1);
        parts.glow.emissiveIntensity = 0.12 * shed + 0.25 * warm;
      }
      if (parts.bars) {
        const fraction = module.charge / MODULES.battery.capacity;
        for (const bar of parts.bars) {
          bar.scale.z = Math.max(0.02, fraction);
        }
        parts.barMaterial.color.setHex(fraction > 0.3 ? 0x6ee7a0 : fraction > 0.1 ? 0xffc24a : 0xff4b3e);
      }
    }
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
