// Module info panel: power, heat, temperature, priority, facing, crew.

import { HEAT } from '../config/balance.js';
import { canRemove } from '../sim/build.js';
import { BATTERY_CUTOFF, getModule, moduleStatus, specOf } from '../sim/state.js';
import { directionName } from '../sim/vec.js';

const one = (n) => (Math.round(n * 10) / 10).toFixed(1);

function describeState(module, spec) {
  const status = moduleStatus(module);
  if (status === 'overheated') return ['bad', `Overheated · restarts below ${HEAT.WARN_TEMP}°`];
  if (status === 'unpowered') return ['bad', module.restartIn > 0 ? `No power · retry in ${Math.ceil(module.restartIn)} s` : 'No power'];
  if (status === 'warn') return ['warn', spec.overheatImmune ? 'Hot' : `Hot · output ${Math.round(module.output * 100)}%`];
  return ['ok', 'Running'];
}

function powerLine(module, spec) {
  if (spec.solar) return `+${one(module.powerOut)} of ${spec.solar} kW`;
  if (spec.capacity) return `${Math.round(module.charge)} of ${spec.capacity} kJ`;
  return module.powered ? `−${spec.draw} kW` : `0 of −${spec.draw} kW`;
}

export function createInspector(root, app) {
  root.innerHTML = `
    <h3 data-name></h3>
    <p class="purpose" data-purpose></p>
    <div class="state" data-state></div>
    <dl>
      <dt>Power</dt><dd data-power></dd>
      <dt>Heat</dt><dd data-heat></dd>
      <dt>Temperature</dt><dd data-temp></dd>
      <dt>Priority</dt><dd data-priority></dd>
      <dt data-facing-label>Facing</dt><dd data-facing></dd>
      <dt data-angle-label></dt><dd data-angle></dd>
      <dt>Crew</dt><dd class="dim">none yet</dd>
    </dl>
    <div class="actions">
      <button data-turn title="Turn the wing a quarter-turn (R)">Turn (R)</button>
      <button data-remove title="Remove this module (Delete)">Remove</button>
    </div>
    <div class="reason" data-reason></div>`;
  const el = {};
  for (const node of root.querySelectorAll('*')) for (const name of Object.keys(node.dataset)) el[name] = node;
  el.turn.addEventListener('click', () => app.rotateSelected());
  el.remove.addEventListener('click', () => app.removeSelected());

  return {
    update(state) {
      const module = getModule(state, app.selectedId);
      root.hidden = !module;
      if (!module) return;
      const spec = specOf(module);
      el.name.textContent = module.name;
      el.purpose.textContent = spec.purpose;
      const [tone, text] = describeState(module, spec);
      el.state.className = `state ${tone}`;
      el.state.textContent = text;
      el.power.textContent = powerLine(module, spec);
      el.heat.textContent = spec.cooling
        ? `−${one(module.heatOut)} of ${spec.cooling} /s`
        : `+${one(module.heatIn)} /s`;
      el.temp.textContent = `${Math.round(module.temp)}° (warn ${HEAT.WARN_TEMP}°, max ${HEAT.MAX_TEMP}°)`;
      el.temp.className = module.temp >= HEAT.MAX_TEMP ? 'bad' : module.temp >= HEAT.WARN_TEMP ? 'warn' : '';

      const consumers = state.priority.filter((id) => id !== BATTERY_CUTOFF);
      const rank = consumers.indexOf(module.id);
      el.priority.textContent = rank < 0 ? '—' : `${rank + 1} of ${consumers.length}${module.onBattery ? '' : ' · sun only'}`;

      const wing = !!spec.wing;
      el.facingLabel.hidden = el.facing.hidden = el.angleLabel.hidden = el.angle.hidden = !wing;
      el.turn.hidden = !wing;
      if (wing) {
        el.facing.textContent = directionName(module.facing);
        el.angleLabel.textContent = spec.solar ? 'Sun on face' : 'Efficiency';
        el.angle.textContent = `${Math.round((spec.solar ? module.sunFacing * state.orbit.sunFactor : module.efficiency) * 100)}%`;
        el.angle.className = spec.cooling && module.efficiency < 0.6 ? 'warn' : '';
      }
      const removable = canRemove(state, module.id);
      el.remove.disabled = !removable.ok;
      el.reason.textContent = removable.ok ? '' : removable.reason;
    },
  };
}
