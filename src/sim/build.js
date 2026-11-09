// Player actions on the station: attachment points, placing and removing
// modules, turning wings, and reordering the power priority list.
// These change the state between ticks; they are not systems.

import { MODULES } from '../data/modules.js';
import { addModule, getModule, moduleCells, specOf, HUB_ID } from './state.js';
import { add, key, neg, perpendiculars, same, scale } from './vec.js';

/** Map of "x,y,z" -> module id for every occupied grid cell. */
export function occupiedCells(state) {
  const taken = new Map();
  for (const m of state.modules) for (const c of moduleCells(m)) taken.set(key(c), m.id);
  return taken;
}

/** Every attachment point of one module, whether or not it is free. */
export function portsOf(module) {
  const spec = specOf(module);
  const last = add(module.cell, scale(module.axis, spec.cells - 1));
  const ports = [];
  for (const kind of spec.ports) {
    if (kind === 'end') ports.push({ from: last, dir: module.axis });
    if (kind === 'back') ports.push({ from: module.cell, dir: neg(module.axis) });
    if (kind === 'sides') for (const dir of perpendiculars(module.axis)) ports.push({ from: last, dir });
  }
  return ports;
}

/** Free attachment points: { parentId, cell, axis } where a new module would start. */
export function attachmentPoints(state) {
  const taken = occupiedCells(state);
  const points = [];
  for (const m of state.modules) {
    for (const port of portsOf(m)) {
      const cell = add(port.from, port.dir);
      if (!taken.has(key(cell))) points.push({ parentId: m.id, cell, axis: port.dir });
    }
  }
  return points;
}

/** Would a module of this type fit at this attachment point? Nothing may overlap. */
export function fitsAt(state, type, point, taken = occupiedCells(state)) {
  for (let i = 0; i < MODULES[type].cells; i++) {
    if (taken.has(key(add(point.cell, scale(point.axis, i))))) return false;
  }
  return true;
}

/** Attachment points where this module type fits. */
export function placementsFor(state, type) {
  const taken = occupiedCells(state);
  return attachmentPoints(state).filter((p) => fitsAt(state, type, p, taken));
}

/** The four ways a wing on this axis can face. */
export const facingOptions = (axis) => perpendiculars(axis);

/** A sensible first facing: solar toward the zenith, radiators edge-on to the sun. */
export function defaultFacing(type, axis) {
  if (!MODULES[type].wing) return null;
  const options = facingOptions(axis);
  const preferred = type === 'solar' ? [[0, 1, 0], [1, 0, 0]] : [[0, 0, 1], [0, 1, 0]];
  for (const want of preferred) {
    const found = options.find((o) => same(o, want));
    if (found) return found;
  }
  return options[0];
}

/** Place a module. Returns { ok, module } or { ok: false, reason }. */
export function placeModule(state, type, { parentId, cell, axis, facing }) {
  const spec = MODULES[type];
  if (!spec || !spec.buildable) return { ok: false, reason: 'That module cannot be built.' };
  if (state.gameOver) return { ok: false, reason: 'The station is lost.' };
  const point = attachmentPoints(state).find(
    (p) => p.parentId === parentId && same(p.cell, cell) && same(p.axis, axis),
  );
  if (!point) return { ok: false, reason: 'There is no free attachment point there.' };
  if (!fitsAt(state, type, point)) return { ok: false, reason: 'Something is in the way.' };
  let face = null;
  if (spec.wing) {
    const options = facingOptions(axis);
    face = (facing && options.find((o) => same(o, facing))) || defaultFacing(type, axis);
  }
  const module = addModule(state, type, { parentId, cell: [...cell], axis: [...axis], facing: face });
  return { ok: true, module };
}

export const childrenOf = (state, id) => state.modules.filter((m) => m.parentId === id);

/** Only leaf modules can come off, and never the hub. */
export function canRemove(state, id) {
  if (id === HUB_ID) return { ok: false, reason: 'The core hub cannot be removed.' };
  if (!getModule(state, id)) return { ok: false, reason: 'No such module.' };
  if (childrenOf(state, id).length) return { ok: false, reason: 'Remove the modules attached to it first.' };
  return { ok: true };
}

export function removeModule(state, id) {
  const check = canRemove(state, id);
  if (!check.ok) return check;
  state.modules = state.modules.filter((m) => m.id !== id);
  state.priority = state.priority.filter((p) => p !== id);
  return { ok: true };
}

/** Turn a wing a quarter-turn around its own length. */
export function rotateFacing(state, id) {
  const m = getModule(state, id);
  if (!m || !specOf(m).wing) return { ok: false, reason: 'Only wings can be turned.' };
  const options = facingOptions(m.axis);
  const i = options.findIndex((o) => same(o, m.facing));
  m.facing = options[(i + 1) % options.length];
  return { ok: true, module: m };
}

/** Move a consumer, or the battery cutoff marker, up (delta −1) or down (+1) the priority list. */
export function movePriority(state, id, delta) {
  const from = state.priority.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= state.priority.length) return { ok: false };
  state.priority.splice(from, 1);
  state.priority.splice(to, 0, id);
  return { ok: true };
}
