// Power priority list: consumers in the order they are fed, with the battery
// cutoff marker. Modules below the cutoff only run on sunlight.

import { BATTERY_CUTOFF, getModule, moduleStatus, specOf } from '../sim/state.js';

export function createPriorityList(root, app) {
  root.innerHTML = `<h2>Power priority</h2><ol></ol><p class="note">Short on power? The bottom of the list shuts down first.</p>`;
  const list = root.querySelector('ol');
  let signature = '';

  function rebuild(state) {
    list.replaceChildren();
    state.priority.forEach((id, index) => {
      const item = document.createElement('li');
      item.dataset.id = id;
      const arrows = `<button data-move="-1" title="Move up" ${index === 0 ? 'disabled' : ''}>▲</button><button data-move="1" title="Move down" ${index === state.priority.length - 1 ? 'disabled' : ''}>▼</button>`;
      if (id === BATTERY_CUTOFF) {
        item.className = 'cutoff';
        item.title = 'Modules below this line never draw on the batteries.';
        item.innerHTML = `<span>Battery cutoff · below: sunlight only</span>${arrows}`;
      } else {
        const module = getModule(state, id);
        item.innerHTML = `<span class="dot"></span><span class="name">${module.name}</span><span class="num dim">${specOf(module).draw} kW</span>${arrows}`;
      }
      list.append(item);
    });
  }

  list.addEventListener('click', (event) => {
    const item = event.target.closest('li');
    if (!item) return;
    const id = Number(item.dataset.id);
    const move = event.target.closest('button')?.dataset.move;
    if (move) app.movePriority(id, Number(move));
    else if (id !== BATTERY_CUTOFF) app.select(id);
  });

  return {
    update(state) {
      const next = state.priority.join(',');
      if (next !== signature) {
        signature = next;
        rebuild(state);
      }
      for (const item of list.children) {
        const id = Number(item.dataset.id);
        if (id === BATTERY_CUTOFF) continue;
        const status = moduleStatus(getModule(state, id));
        item.className = `${status === 'unpowered' || status === 'overheated' ? 'off' : ''} ${id === app.selectedId ? 'selected' : ''}`;
        item.firstChild.className = `dot ${status}`;
      }
    },
  };
}
