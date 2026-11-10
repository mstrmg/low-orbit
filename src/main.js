// Starts the game and runs the main loop: fixed-step simulation, then render.

import * as THREE from 'three';
import './ui/style.css';
import { ORBIT, SIM } from './config/balance.js';
import { BUILD_ORDER, MODULES } from './data/modules.js';
import { createBuildTool } from './render/buildtool.js';
import { applyHeatMap } from './render/effects.js';
import { createScene } from './render/scene.js';
import { createStationView } from './render/station.js';
import { movePriority, placeModule, removeModule, rotateFacing } from './sim/build.js';
import { orbitAt } from './sim/orbit.js';
import { createInitialState, getModule } from './sim/state.js';
import { stepSimulation, TICK_S } from './sim/step.js';
import { createAlerts } from './ui/alerts.js';
import { createBuildBar } from './ui/buildbar.js';
import { createHud } from './ui/hud.js';
import { createInspector } from './ui/inspector.js';
import { createPriorityList } from './ui/priority.js';
import { createTimeline } from './ui/timeline.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const view = createScene(canvas);
const station = createStationView(view.stationRoot);
const buildTool = createBuildTool(view.stationRoot);

const app = {
  state: createInitialState(),
  paused: true,
  speed: 1,
  selectedId: null,
  buildType: null,
  heatMap: false,

  togglePause() {
    if (!app.state.gameOver) app.paused = !app.paused;
  },
  setSpeed(speed) {
    app.speed = speed;
    app.paused = false;
  },
  select(id) {
    app.selectedId = id;
  },
  setBuildType(type) {
    app.buildType = type;
    buildTool.setType(type, app.state);
  },
  toggleHeatMap() {
    app.heatMap = !app.heatMap;
  },
  rotateSelected() {
    rotateFacing(app.state, app.selectedId);
  },
  removeSelected() {
    if (removeModule(app.state, app.selectedId).ok) {
      app.selectedId = null;
      buildTool.refresh(app.state);
    }
  },
  movePriority(id, delta) {
    movePriority(app.state, id, delta);
  },
  restart() {
    app.state = createInitialState();
    app.paused = true;
    app.selectedId = null;
    accumulator = 0;
    alerts.reset();
    app.setBuildType(null);
    $('overlay').hidden = true;
    gameOverShown = false;
  },
};

const timeline = createTimeline($('timeline'));
const hud = createHud($('hud'));
const alerts = createAlerts($('alerts'));
const priority = createPriorityList($('priority'), app);
const inspector = createInspector($('inspector'), app);
const buildBar = createBuildBar($('buildbar'), $('build-hint'), app);

// --- Time controls -------------------------------------------------------------
const controls = $('controls');
const speedButtons = [];
function addControl(label, title, onClick, isOn) {
  const button = document.createElement('button');
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  controls.append(button);
  speedButtons.push({ button, isOn });
}
addControl('❚❚', 'Pause (Space)', () => app.togglePause(), () => app.paused);
for (const speed of [1, 2, 4]) addControl(`${speed}×`, `${speed}× speed`, () => app.setSpeed(speed), () => !app.paused && app.speed === speed);
addControl('H', 'Heat-map view (H)', () => app.toggleHeatMap(), () => app.heatMap);

// --- Overlay: intro and game over ----------------------------------------------
function showIntro() {
  const overlay = $('overlay');
  overlay.hidden = false;
  overlay.innerHTML = `
    <div class="card">
      <h1>Low Orbit</h1>
      <p class="tag">Every decision is really about getting through the next eclipse.</p>
      <ul>
        <li>Each ${ORBIT.PERIOD_S} s orbit is ${ORBIT.SUNLIT_S} s of sunlight, then ${ORBIT.PERIOD_S - ORBIT.SUNLIT_S} s of eclipse.</li>
        <li>Pick a module below and click a glowing ring to attach it. Building is free.</li>
        <li>Solar wings make power in sunlight; batteries carry you through the dark.</li>
        <li>Everything running makes heat. Radiators shed it best edge-on to the sun.</li>
        <li>If the core hub stays dark too long, the station is lost.</li>
      </ul>
      <button>Begin</button>
    </div>`;
  overlay.querySelector('button').addEventListener('click', () => (overlay.hidden = true));
}

let gameOverShown = false;
function showGameOver(over) {
  gameOverShown = true;
  app.setBuildType(null);
  const overlay = $('overlay');
  overlay.hidden = false;
  overlay.innerHTML = `
    <div class="card">
      <h1>${over.title}</h1>
      <p class="tag">Orbit ${over.orbit}</p>
      <p></p>
      <div class="stats">
        <div><span>Orbits flown</span>${over.orbit - 1}</div>
        <div><span>Research data</span>${Math.floor(app.state.research)}</div>
        <div><span>Modules</span>${app.state.modules.length}</div>
      </div>
      <button>Try again</button>
    </div>`;
  overlay.querySelector('p:not(.tag)').textContent = over.text;
  overlay.querySelector('button').addEventListener('click', () => app.restart());
}

// --- Pointer: select modules, place modules -----------------------------------
const ndc = new THREE.Vector2();
let downAt = null;
function toNdc(event) {
  const rect = canvas.getBoundingClientRect();
  ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
}
canvas.addEventListener('pointerdown', (event) => (downAt = { x: event.clientX, y: event.clientY, button: event.button }));
canvas.addEventListener('pointermove', (event) => {
  toNdc(event);
  canvas.style.cursor = buildTool.hover(ndc, view.camera) ? 'pointer' : '';
});
canvas.addEventListener('pointerup', (event) => {
  if (!downAt || downAt.button !== 0) return;
  const dragged = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5;
  downAt = null;
  if (dragged) return;
  toNdc(event);
  if (app.buildType) {
    buildTool.hover(ndc, view.camera);
    const placement = buildTool.placement();
    if (!placement) return;
    const result = placeModule(app.state, placement.type, placement);
    if (result.ok) {
      app.selectedId = result.module.id;
      buildTool.refresh(app.state);
    }
  } else {
    app.select(station.pick(ndc, view.camera));
  }
});
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (app.buildType) app.setBuildType(null);
});

// --- Keyboard ------------------------------------------------------------------
window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const k = event.key.toLowerCase();
  if (k === ' ') {
    event.preventDefault();
    if (!$('overlay').hidden && !app.state.gameOver) $('overlay').hidden = true;
    else app.togglePause();
  } else if (k >= '1' && k <= '4') {
    view.setPreset(Number(k) - 1, lastBounds.radius);
  } else if (k === 'h') {
    app.toggleHeatMap();
  } else if (k === 'r') {
    if (!buildTool.rotate()) app.rotateSelected();
  } else if (k === 'escape') {
    if (app.buildType) app.setBuildType(null);
    else app.select(null);
  } else if (k === 'delete' || k === 'backspace') {
    app.removeSelected();
  } else {
    const type = BUILD_ORDER.find((t) => MODULES[t].hotkey === k);
    if (type) app.setBuildType(app.buildType === type ? null : type);
  }
});

// --- Main loop -----------------------------------------------------------------
let last = performance.now();
let accumulator = 0; // s of game time not yet simulated
let lastBounds = { radius: 4 };
let uiClock = 0;

function frame(nowMs) {
  const realDt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  const now = nowMs / 1000;
  const { state } = app;

  if (!app.paused && !state.gameOver) {
    accumulator += realDt * app.speed;
    let ticks = 0;
    while (accumulator >= TICK_S && ticks < SIM.MAX_TICKS_PER_FRAME) {
      stepSimulation(state);
      accumulator -= TICK_S;
      ticks += 1;
    }
    if (ticks === SIM.MAX_TICKS_PER_FRAME) accumulator = 0;
  }
  if (state.gameOver && !gameOverShown) showGameOver(state.gameOver);
  if (!getModule(state, app.selectedId)) app.selectedId = null;

  // Draw between ticks so the sun and planet move smoothly.
  const renderTime = state.time + (app.paused || state.gameOver ? 0 : accumulator);
  lastBounds = station.sync(state, now);
  view.frameStation(lastBounds);
  station.update(state, now, realDt);
  station.setSelected(app.selectedId);
  applyHeatMap(station, state, app.heatMap);
  buildTool.animate(now);
  view.update(orbitAt(renderTime), renderTime, realDt);
  view.render();

  timeline.update(state, renderTime, app.paused);
  uiClock += realDt;
  if (uiClock > 0.1) {
    uiClock = 0;
    hud.update(state);
    priority.update(state);
    inspector.update(state);
    alerts.update(state);
    buildBar.update();
    for (const { button, isOn } of speedButtons) button.classList.toggle('on', isOn());
  }
  requestAnimationFrame(frame);
}

showIntro();
requestAnimationFrame(frame);

// Handle for debugging and automated checks.
window.lowOrbit = { app, view, station, step: (n = 1) => { for (let i = 0; i < n; i++) stepSimulation(app.state); } };
