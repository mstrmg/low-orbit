// Build mode visuals: glowing markers on every attachment point where the
// chosen module fits, and a translucent ghost of the module under the pointer.

import * as THREE from 'three';
import { MODULES } from '../data/modules.js';
import { defaultFacing, facingOptions, placementsFor } from '../sim/build.js';
import { key, same } from '../sim/vec.js';
import { buildModuleMesh, cellToWorld, CELL, moduleQuaternion } from './station.js';

export function createBuildTool(root) {
  const layer = new THREE.Group();
  layer.name = 'build-tool';
  root.add(layer);
  const raycaster = new THREE.Raycaster();
  const ringGeometry = new THREE.TorusGeometry(0.34, 0.045, 8, 24);
  const hitGeometry = new THREE.SphereGeometry(0.6, 8, 6);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.85, depthTest: false });
  const hotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 0.38, depthWrite: false });

  let type = null;
  let markers = []; // { point, ring, hit }
  let hovered = null;
  let ghost = null;
  let arrow = null;
  const chosenFacing = new Map(); // "type:axis" -> facing the player picked with R

  function clearGhost() {
    if (ghost) layer.remove(ghost);
    ghost = arrow = null;
  }

  function clear() {
    for (const marker of markers) layer.remove(marker.ring, marker.hit);
    markers = [];
    hovered = null;
    clearGhost();
  }

  /** Show markers for a module type (null to leave build mode). */
  function setType(next, state) {
    type = next;
    refresh(state);
  }

  /** Rebuild markers after the station changes. */
  function refresh(state) {
    clear();
    if (!type) return;
    for (const point of placementsFor(state, type)) {
      const position = cellToWorld(point.cell).addScaledVector(new THREE.Vector3(...point.axis), -CELL / 2);
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.copy(position);
      ring.quaternion.copy(moduleQuaternion(point.axis, null));
      ring.renderOrder = 10;
      const hit = new THREE.Mesh(hitGeometry, hitMaterial);
      hit.position.copy(position).addScaledVector(new THREE.Vector3(...point.axis), 0.3);
      layer.add(ring, hit);
      markers.push({ point, ring, hit });
    }
  }

  function facingFor(point) {
    if (!MODULES[type].wing) return null;
    const picked = chosenFacing.get(`${type}:${key(point.axis)}`);
    return picked ?? defaultFacing(type, point.axis);
  }

  function showGhost() {
    clearGhost();
    if (!hovered) return;
    const { point } = hovered;
    const facing = facingFor(point);
    ghost = buildModuleMesh(type).group;
    ghost.traverse((o) => {
      if (!o.isMesh) return;
      o.material = ghostMaterial;
      o.castShadow = o.receiveShadow = false;
    });
    if (facing) {
      const mid = (MODULES[type].cells * CELL) / 2 - CELL / 2;
      arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.1, mid), 1.5, 0xffe08a, 0.4, 0.25);
      ghost.add(arrow);
    }
    ghost.position.copy(cellToWorld(point.cell));
    ghost.quaternion.copy(moduleQuaternion(point.axis, facing));
    layer.add(ghost);
  }

  /** Track the pointer. Returns true while it is over an attachment point. */
  function hover(ndc, camera) {
    if (!type) return false;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(markers.map((m) => m.hit), false);
    const next = hits.length ? markers.find((m) => m.hit === hits[0].object) : null;
    if (next !== hovered) {
      if (hovered) hovered.ring.material = ringMaterial;
      hovered = next;
      if (hovered) hovered.ring.material = hotMaterial;
      showGhost();
    }
    return !!hovered;
  }

  /** Quarter-turn the ghost wing (R key). */
  function rotate() {
    if (!hovered || !MODULES[type].wing) return false;
    const { axis } = hovered.point;
    const options = facingOptions(axis);
    const current = facingFor(hovered.point);
    const next = options[(options.findIndex((o) => same(o, current)) + 1) % options.length];
    chosenFacing.set(`${type}:${key(axis)}`, next);
    showGhost();
    return true;
  }

  /** What would be placed on click: { type, parentId, cell, axis, facing } or null. */
  function placement() {
    if (!hovered) return null;
    return { type, ...hovered.point, facing: facingFor(hovered.point) };
  }

  function animate(now) {
    const pulse = 1 + 0.12 * Math.sin(now * 5);
    for (const marker of markers) marker.ring.scale.setScalar(marker === hovered ? 1.35 : pulse);
  }

  return { setType, refresh, hover, rotate, placement, animate, get type() { return type; } };
}
