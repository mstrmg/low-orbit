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
    const bandTop = 5;
    const bandHeight = 22;
    const bandBottom = bandTop + bandHeight;
    const now = x(time);

    // Sunlit and eclipse bands.
    const edges = [{ time: from }, ...transitionsBetween(from, to), { time: to }];
    for (let i = 0; i < edges.length - 1; i++) {
      const mid = (edges[i].time + edges[i + 1].time) / 2;
      const phase = ((mid % ORBIT.PERIOD_S) + ORBIT.PERIOD_S) % ORBIT.PERIOD_S;
      const sunlit = phase < ORBIT.SUNLIT_S;
      const left = x(edges[i].time);
      const right = x(edges[i + 1].time);
      const fill = ctx.createLinearGradient(0, bandTop, 0, bandBottom);
      if (sunlit) {
        fill.addColorStop(0, '#ffd27a');
        fill.addColorStop(1, '#f0a23c');
      } else {
        fill.addColorStop(0, '#1b2a63');
        fill.addColorStop(1, '#101a44');
      }
      ctx.fillStyle = fill;
      ctx.fillRect(left, bandTop, right - left, bandHeight);
      if (!sunlit) {
        // a few fixed "stars" so the eclipse reads as night at a glance
        ctx.fillStyle = 'rgba(190, 210, 255, 0.55)';
        const start = Math.floor(edges[i].time / 3) * 3;
        for (let t = start; t < edges[i + 1].time; t += 3) {
          const sx = x(t + ((t * 7) % 3) * 0.6);
          if (sx > left + 2 && sx < right - 2) ctx.fillRect(sx, bandTop + 4 + ((t * 13) % 14), 1.5, 1.5);
        }
      }
    }
    // The past is dimmed.
    ctx.fillStyle = 'rgba(4, 8, 18, 0.5)';
    ctx.fillRect(0, bandTop, now, bandHeight);

    // Ruler: a tick every 10 s of game time.
    ctx.fillStyle = 'rgba(170, 200, 255, 0.4)';
    for (let t = Math.ceil(from / 10) * 10; t <= to; t += 10) {
      const major = Math.round(t) % 30 === 0;
      ctx.fillRect(Math.round(x(t)), bandBottom + 1, 1, major ? 5 : 3);
    }

    // Labels for upcoming sunsets and sunrises.
    ctx.font = "10px 'B612', ui-monospace, Menlo, Consolas, monospace";
    ctx.textBaseline = 'top';
    let lastRight = -Infinity;
    for (const edge of transitionsBetween(time, to)) {
      const label = `${edge.kind === 'sunset' ? 'eclipse' : `orbit ${edge.orbit}`} ${Math.ceil(edge.time - time)}s`;
      const textWidth = ctx.measureText(label).width;
      const at = Math.min(x(edge.time) + 3, width - textWidth);
      if (at < lastRight + 8) continue; // never print one label over another
      lastRight = at + textWidth;
      ctx.fillStyle = edge.kind === 'sunset' ? '#9db4ff' : '#ffcf85';
      ctx.fillRect(Math.round(x(edge.time)), bandBottom + 1, 1, 9);
      ctx.fillText(label, at, bandBottom + 8);
    }

    // Now.
    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#fff';
    ctx.fillRect(now - 1, 1, 2, bandBottom + 3);
    ctx.shadowBlur = 0;
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
