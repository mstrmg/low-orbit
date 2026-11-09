// Gauges: power, batteries, heat, core reserve, research.

import { HEAT, LOSE, ORBIT, RESEARCH } from '../config/balance.js';
import { secondsToNextTransition } from '../sim/orbit.js';
import { getHub, getModule } from '../sim/state.js';

const ECLIPSE_S = ORBIT.PERIOD_S - ORBIT.SUNLIT_S;
const RESERVE_FULL_S = LOSE.CORE_BLACKOUT_ORBITS * ORBIT.PERIOD_S;
const one = (n) => (Math.round(n * 10) / 10).toFixed(1);
const signed = (n) => `${n >= 0 ? '+' : '−'}${one(Math.abs(n))}`;
const pct = (n) => `${Math.max(0, Math.min(100, n * 100))}%`;

export function createHud(root) {
  root.innerHTML = `
    <div class="gauge">
      <h2>Power</h2>
      <div class="big num"><span data-net></span> <small>kW net</small></div>
      <div class="bar tall" title="Fill: supply. White line: demand."><i data-supply style="background:var(--sun)"></i><b data-demand></b></div>
      <div class="row"><span class="dim">make / use / want</span><span class="num" data-flow></span></div>
    </div>
    <div class="gauge">
      <h2>Batteries</h2>
      <div class="bar tall"><i data-stored style="background:var(--ok)"></i></div>
      <div class="row"><span class="num" data-stored-text></span><span data-forecast></span></div>
      <div class="row"><span class="dim">next eclipse needs</span><span class="num" data-needs></span></div>
    </div>
    <div class="gauge">
      <h2>Heat</h2>
      <div class="big num"><span data-temp></span><small>° <span data-hottest></span></small></div>
      <div class="bar tall" title="Lines: warn and max temperature."><i data-temp-bar></i><b style="left:${(HEAT.WARN_TEMP / (HEAT.MAX_TEMP + 10)) * 100}%;opacity:.5"></b><b style="left:${(HEAT.MAX_TEMP / (HEAT.MAX_TEMP + 10)) * 100}%"></b></div>
      <div class="row"><span class="dim">heat in / out</span><span class="num" data-heat></span></div>
    </div>
    <div class="gauge">
      <h2>Core reserve</h2>
      <div class="bar"><i data-reserve></i></div>
      <div class="row"><span data-reserve-text></span><span class="num" data-reserve-s></span></div>
    </div>
    <div class="gauge">
      <h2>Research data</h2>
      <div class="big num"><span data-research></span> <small data-rate></small></div>
    </div>`;
  const el = {};
  for (const node of root.querySelectorAll('*')) for (const name of Object.keys(node.dataset)) el[name] = node;

  return {
    update(state) {
      const { power, heat, orbit } = state;
      el.net.textContent = signed(power.net);
      el.net.className = power.shedCount ? 'bad' : power.net >= 0 ? 'ok' : 'warn';
      const scale = Math.max(power.supply, power.demand, 4) * 1.15;
      el.supply.style.width = pct(power.supply / scale);
      el.demand.style.left = pct(power.demand / scale);
      el.flow.textContent = `${one(power.supply)} / ${one(power.load)} / ${one(power.demand)}`;

      el.stored.style.width = pct(power.capacity ? power.stored / power.capacity : 0);
      el.storedText.textContent = `${Math.round(power.stored)} / ${power.capacity} kJ`;
      let forecast = '';
      let tone = 'dim';
      if (!power.capacity) {
        forecast = 'no battery';
        tone = 'warn';
      } else if (power.net < -0.05 && power.stored > 0) {
        const lasts = power.stored / -power.net;
        const dark = orbit.sunlit ? Infinity : secondsToNextTransition(orbit);
        if (lasts < dark && !orbit.sunlit) {
          forecast = `empty ${Math.ceil(dark - lasts)} s before sunrise`;
          tone = 'bad';
        } else {
          forecast = `lasts ${Math.round(lasts)} s`;
        }
      } else if (power.net > 0.05 && power.stored < power.capacity - 0.5) {
        forecast = `full in ${Math.ceil((power.capacity - power.stored) / power.net)} s`;
        tone = 'ok';
      } else if (power.stored >= power.capacity - 0.5) {
        forecast = 'full';
        tone = 'ok';
      } else if (power.stored < 0.5) {
        forecast = 'empty';
        tone = orbit.sunlit ? 'dim' : 'bad';
      }
      el.forecast.textContent = forecast;
      el.forecast.className = tone;
      const needs = power.batteryDemand * ECLIPSE_S;
      el.needs.textContent = `${Math.round(needs)} kJ`;
      el.needs.className = `num ${needs > power.capacity ? 'bad' : 'dim'}`;

      const hottest = getModule(state, heat.hottestId) ?? getHub(state);
      const tempTone = heat.maxTemp >= HEAT.MAX_TEMP ? 'bad' : heat.maxTemp >= HEAT.WARN_TEMP ? 'warn' : 'ok';
      el.temp.textContent = Math.round(heat.maxTemp);
      el.temp.className = tempTone;
      el.hottest.textContent = hottest.name;
      el.tempBar.style.width = pct(heat.maxTemp / (HEAT.MAX_TEMP + 10));
      el.tempBar.style.background = `var(--${tempTone})`;
      el.heat.textContent = `${one(heat.generated + heat.solar)} / ${one(heat.removed)}`;

      const hubDark = !getHub(state).powered;
      el.reserve.style.width = pct(state.coreReserveS / RESERVE_FULL_S);
      el.reserve.style.background = hubDark ? 'var(--bad)' : 'var(--accent)';
      el.reserveText.textContent = hubDark ? 'Core hub is dark' : 'Core hub running';
      el.reserveText.className = hubDark ? 'bad' : 'dim';
      el.reserveS.textContent = `${Math.ceil(state.coreReserveS)} s`;

      const rate = state.modules.reduce((sum, m) => sum + (m.type === 'lab' ? m.output * RESEARCH.POINTS_PER_S : 0), 0);
      el.research.textContent = Math.floor(state.research);
      el.rate.textContent = `+${one(rate)}/s`;
    },
  };
}
