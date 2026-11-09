// Bottom build bar: one button per placeable module.

import { BUILD_ORDER, MODULES } from '../data/modules.js';

function stats(spec) {
  const parts = [];
  if (spec.solar) parts.push(`+${spec.solar} kW sun`);
  if (spec.draw) parts.push(`−${spec.draw} kW`);
  if (spec.capacity) parts.push(`${spec.capacity} kJ`);
  if (spec.heat) parts.push(`+${spec.heat} heat`);
  if (spec.cooling) parts.push(`−${spec.cooling} heat`);
  return parts.join(' · ');
}

export function createBuildBar(root, hintRoot, app) {
  const buttons = new Map();
  for (const type of BUILD_ORDER) {
    const spec = MODULES[type];
    const button = document.createElement('button');
    button.title = spec.purpose;
    button.innerHTML = `<div class="name"><span>${spec.name}</span><kbd>${spec.hotkey.toUpperCase()}</kbd></div><div class="stats">${stats(spec)}</div>`;
    button.addEventListener('click', () => app.setBuildType(app.buildType === type ? null : type));
    root.append(button);
    buttons.set(type, button);
  }
  return {
    update() {
      for (const [type, button] of buttons) button.classList.toggle('on', app.buildType === type);
      const spec = app.buildType && MODULES[app.buildType];
      hintRoot.textContent = spec
        ? `Click a glowing ring to attach a ${spec.name.toLowerCase()}${spec.wing ? ' · R: turn it' : ''} · Esc: done`
        : '';
    },
  };
}
