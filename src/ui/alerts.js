// Alert toasts: the newest few lines of the alert log, fading after a while.

const SHOW = 4; // toasts on screen at once
const LIFE_MS = 12000; // real time a toast stays

export function createAlerts(root) {
  let lastId = 0;
  return {
    update(state) {
      for (const alert of state.alerts) {
        if (alert.id <= lastId) continue;
        lastId = alert.id;
        const node = document.createElement('div');
        node.className = `alert ${alert.level}`;
        const stamp = document.createElement('time');
        stamp.textContent = `${Math.floor(alert.time / 60)}:${String(Math.floor(alert.time % 60)).padStart(2, '0')}`;
        node.append(stamp, alert.text);
        root.append(node);
        setTimeout(() => node.classList.add('old'), LIFE_MS);
        setTimeout(() => node.remove(), LIFE_MS + 700);
      }
      while (root.children.length > SHOW) root.firstChild.remove();
    },
    reset() {
      lastId = 0;
      root.replaceChildren();
    },
  };
}
