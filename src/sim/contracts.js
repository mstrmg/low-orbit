// Contracts and economy arrive in milestone 2. For milestone 1 this step only
// adds up research data from labs, which is the score.

import { RESEARCH } from '../config/balance.js';
import { outputFactorAt } from './heat.js';

/** System: contracts (milestone 2). For now, labs accrue research data. */
export function updateContracts(state, dt) {
  accrueResearch(state, dt);
}

/** A powered lab makes research data, less of it above the warn temperature. */
export function accrueResearch(state, dt) {
  for (const m of state.modules) {
    if (m.type !== 'lab') continue;
    m.output = m.powered && !m.overheated ? outputFactorAt(m.temp) : 0;
    state.research += RESEARCH.POINTS_PER_S * m.output * dt;
  }
}
