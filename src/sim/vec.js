// Tiny helpers for 3-number arrays. Plain arrays keep the state JSON-friendly.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const neg = (a) => [-a[0] || 0, -a[1] || 0, -a[2] || 0];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const key = (a) => `${a[0]},${a[1]},${a[2]}`;

/** The four unit directions at right angles to a grid axis, in a stable order. */
export function perpendiculars(axis) {
  const all = [
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
    [-1, 0, 0],
  ];
  return all.filter((d) => dot(d, axis) === 0);
}

const DIR_NAMES = {
  '1,0,0': 'sunset side (+X)',
  '-1,0,0': 'sunrise side (−X)',
  '0,1,0': 'zenith (+Y)',
  '0,-1,0': 'planet (−Y)',
  '0,0,1': 'orbit north (+Z)',
  '0,0,-1': 'orbit south (−Z)',
};
export const directionName = (d) => DIR_NAMES[key(d)] ?? key(d);
