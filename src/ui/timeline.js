// Orbit timeline: where the station is now, and the sunrises and sunsets ahead.

import { ORBIT } from '../config/balance.js';
import { secondsToNextTransition, transitionsBetween } from '../sim/orbit.js';

const BEHIND_S = 12; // s of the past shown left of the "now" line
const AHEAD_S = ORBIT.PERIOD_S * 2 - BEHIND_S; // s of the future shown

export function createTimeline(root) {
  root.innerHTML = `
    <div class="status"><span data-orbit></span><span data-phase></span><span data-clock class="num dim"></span></div>
    <canvas></canvas>`;
  const orbitEl = root.querySelector('[data-orbit]');
  const phaseEl = root.querySelector('[data-phase]');
  const clockEl = root.querySelector('[data-clock]');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');

  function draw(time) {
    const ratio = Math.min(window.devicePixelRatio, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const from = time - BEHIND_S;
    const to = time + AHEAD_S;
    const x = (t) => ((t - from) / (to - from)) * width;
    const bandTop = 4;
    const bandHeight = 20;

    // Sunlit and eclipse bands.
    const edges = [{ time: from }, ...transitionsBetween(from, to), { time: to }];
    for (let i = 0; i < edges.length - 1; i++) {
      const mid = (edges[i].time + edges[i + 1].time) / 2;
      const phase = ((mid % ORBIT.PERIOD_S) + ORBIT.PERIOD_S) % ORBIT.PERIOD_S;
      ctx.fillStyle = phase < ORBIT.SUNLIT_S ? 'rgba(255, 200, 107, 0.85)' : 'rgba(52, 78, 150, 0.75)';
      ctx.fillRect(x(edges[i].time), bandTop, x(edges[i + 1].time) - x(edges[i].time) - 1, bandHeight);
    }

    // Labels for upcoming sunsets and sunrises.
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    for (const edge of transitionsBetween(time, to)) {
      const label = `${edge.kind === 'sunset' ? 'eclipse' : `orbit ${edge.orbit}`} ${Math.ceil(edge.time - time)}s`;
      ctx.fillStyle = edge.kind === 'sunset' ? '#9db8ff' : '#ffd590';
      const textWidth = ctx.measureText(label).width;
      ctx.fillText(label, Math.min(x(edge.time) + 2, width - textWidth), bandTop + bandHeight + 4);
    }

    // Now.
    const now = x(time);
    ctx.fillStyle = '#fff';
    ctx.fillRect(now - 1, 0, 2, bandTop + bandHeight + 4);
    ctx.beginPath();
    ctx.moveTo(now - 5, 0);
    ctx.lineTo(now + 5, 0);
    ctx.lineTo(now, 6);
    ctx.fill();
  }

  return {
    update(state, time, paused) {
      const { orbit } = state;
      const left = Math.ceil(secondsToNextTransition(orbit));
      orbitEl.textContent = `Orbit ${orbit.number}`;
      phaseEl.className = orbit.sunlit ? 'sun' : 'eclipse';
      phaseEl.textContent = state.gameOver
        ? 'Station lost'
        : paused
          ? 'Paused · build, then press Space'
          : orbit.sunlit
            ? `Sunlit · eclipse in ${left} s`
            : `Eclipse · sunrise in ${left} s`;
      const minutes = Math.floor(state.time / 60);
      clockEl.textContent = `${minutes}:${String(Math.floor(state.time % 60)).padStart(2, '0')}`;
      draw(time);
    },
  };
}
