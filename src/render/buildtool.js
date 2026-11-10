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
  const ringGeometry = new THREE.TorusGeometry(0.36, 0.035, 8, 32);
  const dotGeometry = new THREE.CircleGeometry(0.09, 16);
  const hitGeometry = new THREE.SphereGeometry(0.6, 8, 6);
  // Colours above 1 so the markers pick up a soft glow.
  const ringMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.25, 1.5), transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
  const hotMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2), depthTest: false, transparent: true, side: THREE.DoubleSide });
  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  // The ghost: a see-through hologram of the module, brighter along its edges.
  const ghostMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x8fe9ff) } },
    vertexShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vToCamera;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vToCamera = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec3 vNormalV;
      varying vec3 vToCamera;
      void main(){
        float edge = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vToCamera))), 2.0);
        float scan = 0.88 + 0.12 * sin(gl_FragCoord.y * 0.9 - uTime * 5.0);
        gl_FragColor = vec4(uColor * (0.55 + 1.5 * edge) * scan, 0.26 + 0.55 * edge);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

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
      const dot = new THREE.Mesh(dotGeometry, ringMaterial);
      dot.renderOrder = 10;
      ring.add(dot);
      const hit = new THREE.Mesh(hitGeometry, hitMaterial);
      hit.position.copy(position).addScaledVector(new THREE.Vector3(...point.axis), 0.3);
      layer.add(ring, hit);
      markers.push({ point, ring, hit });
    }
  }

  function setMarkerMaterial(marker, material) {
    marker.ring.material = material;
    for (const child of marker.ring.children) child.material = material;
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
      arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.1, mid), 1.5, 0xffc86b, 0.4, 0.25);
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
      if (hovered) setMarkerMaterial(hovered, ringMaterial);
      hovered = next;
      if (hovered) setMarkerMaterial(hovered, hotMaterial);
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
    ghostMaterial.uniforms.uTime.value = now;
    const pulse = 1 + 0.12 * Math.sin(now * 5);
    for (const marker of markers) marker.ring.scale.setScalar(marker === hovered ? 1.35 : pulse);
  }

  return { setType, refresh, hover, rotate, placement, animate, get type() { return type; } };
}
