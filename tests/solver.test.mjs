import { solveShape } from '../js/solver.js';
import { dist, shapeArea, interiorAngleDeg, segmentCount } from '../js/geometry.js';
import { formatLength, parseLengthText, feetInchesToM } from '../js/units.js';
import assert from 'node:assert/strict';

const mk = (pts, closed = true) => ({
  vertices: pts.map(([x, y]) => ({ x, y })),
  segments: pts.slice(0, closed ? pts.length : pts.length - 1).map(() => ({ type: 'line', bulge: 0, length: null })),
  closed,
});
const apply = (s, r) => ({ ...s, vertices: r.vertices, segments: r.segments });
const near = (a, b, t = 1e-3) => assert.ok(Math.abs(a - b) < t, `${a} ≉ ${b}`);

// 1. Retângulo torto esboçado → medidas 10 x 5 → retângulo exato.
{
  let s = mk([[0, 0], [7.3, 0.4], [7.1, 3.9], [-0.2, 3.6]]);
  s.segments[0].length = 10; s.segments[1].length = 5;
  const r = solveShape(s); s = apply(s, r);
  near(dist(s.vertices[0], s.vertices[1]), 10);
  near(dist(s.vertices[1], s.vertices[2]), 5);
  near(dist(s.vertices[2], s.vertices[3]), 10, 1e-2);
  near(dist(s.vertices[3], s.vertices[0]), 5, 1e-2);
  near(shapeArea(s), 50, 0.05);
  for (let i = 0; i < 4; i++) near(interiorAngleDeg(s, i), 90, 0.3);
  assert.equal(r.report.badSegments.length, 0);
  console.log('ok retângulo', shapeArea(s).toFixed(3));
}
// 2. Medidas inconsistentes (10 e 9 em lados opostos de um retângulo) → sinaliza.
{
  let s = mk([[0, 0], [10, 0], [10, 5], [0, 5]]);
  s.segments[0].length = 10; s.segments[2].length = 9; s.segments[1].length = 5;
  const r = solveShape(s);
  assert.ok(r.report.badSegments.length + r.report.badVertices.length > 0);
  console.log('ok inconsistência', r.report);
}
// 3. Forma em L com todas as medidas, alterar uma → reajusta.
{
  let s = mk([[0, 0], [6, 0], [6, 2], [3, 2.2], [3, 5], [0, 5]]);
  const L = [6, 2, 3, 3, 3, 5];
  L.forEach((v, i) => (s.segments[i].length = v));
  let r = solveShape(s); s = apply(s, r);
  assert.equal(r.report.badSegments.length, 0);
  near(shapeArea(s), 6 * 2 + 3 * 3, 0.05);
  s.segments[0].length = 8; s.segments[2].length = 5;
  r = solveShape(s); s = apply(s, r);
  assert.equal(r.report.badSegments.length, 0, JSON.stringify(r.report));
  near(shapeArea(s), 8 * 2 + 3 * 3, 0.05);
  console.log('ok L', shapeArea(s).toFixed(3));
}
// 4. Triângulo com 3 lados: determinado.
{
  let s = mk([[0, 0], [4, 0], [1, 2.5]]);
  [3, 4, 5].forEach((v, i) => (s.segments[i].length = v));
  const r = solveShape(s); s = apply(s, r);
  for (let i = 0; i < 3; i++) near(dist(s.vertices[i], s.vertices[(i + 1) % 3]), [3, 4, 5][i], 5e-3);
  console.log('ok triângulo', r.report.badSegments);
}
// 5. Unidades
assert.equal(formatLength(feetInchesToM(12, 6), 'ft'), `12' 6"`);
assert.equal(formatLength(feetInchesToM(0, 6.5), 'ft'), `6½"`);
near(parseLengthText(`12' 6"`, 'ft'), feetInchesToM(12, 6), 1e-9);
near(parseLengthText(`12 6`, 'ft'), feetInchesToM(12, 6), 1e-9);
near(parseLengthText(`3,45`, 'm'), 3.45, 1e-9);
near(parseLengthText(`6 1/2"`, 'ft'), feetInchesToM(0, 6.5), 1e-9);
console.log('ok unidades');
