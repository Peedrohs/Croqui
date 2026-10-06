import assert from 'node:assert/strict';
import { newContent, newShape, newSegment, splitSegment, splitSegmentN, removeVertex, mergeWithNext, simplifyShape, closeShape, mergeVertices, looseVertices, solveInContent, stats } from '../js/model.js';
import { dist, shapeArea, segmentCount } from '../js/geometry.js';
const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) < t, `${a} ≉ ${b}`);
const rect = () => { const s = newShape({ x: 0, y: 0 }); s.vertices = [[0, 0], [10, 0], [10, 5], [0, 5]].map(([x, y]) => ({ x, y, angleMode: 'auto' })); s.segments = [0, 1, 2, 3].map(() => newSegment('line')); s.closed = true; return s; };

// split proporcional + solver mantém a reta
{ const c = newContent('m'); const s = rect(); c.shapes.push(s); s.segments[0].length = 10;
  splitSegment(s, 0, 0.3);
  assert.equal(s.vertices.length, 5); near(s.segments[0].length, 3); near(s.segments[1].length, 7);
  s.segments[0].length = 4; solveInContent(c, s);
  near(dist(s.vertices[0], s.vertices[1]), 4, 5e-3); near(dist(s.vertices[1], s.vertices[2]), 7, 5e-3);
  near(s.vertices[1].y, s.vertices[0].y, 5e-3); near(s.vertices[2].y, s.vertices[0].y, 5e-3); // continua reta e sem girar
  console.log('ok split');
}
// N partes
{ const c = newContent('m'); const s = rect(); c.shapes.push(s); s.segments[0].length = 9; splitSegmentN(s, 0, 3);
  assert.equal(segmentCount(s), 6); [0, 1, 2].forEach((k) => near(s.segments[k].length, 3, 1e-9)); near(s.vertices[1].x, 10 / 3, 1e-9); near(s.vertices[2].x, 20 / 3, 1e-9); console.log('ok split N'); }
// merge com soma
{ const c = newContent('m'); const s = rect(); c.shapes.push(s); s.segments[0].length = 10; splitSegment(s, 0, 0.5); s.segments[0].length = 4; s.segments[1].length = 6;
  mergeWithNext(c, s, 0); assert.equal(s.vertices.length, 4); near(s.segments[0].length, 10); console.log('ok merge'); }
// simplificar
{ const c = newContent('m'); const s = rect(); c.shapes.push(s); splitSegment(s, 0, 0.5); s.vertices[1].y += 0.05; splitSegment(s, 2, 0.5);
  const r = simplifyShape(c, s, 4); assert.equal(r, 2); assert.equal(s.vertices.length, 4); near(shapeArea(s), 50, 1e-6); console.log('ok simplify'); }
// unir pontas da mesma forma aberta → fecha
{ const c = newContent('m'); const s = newShape({ x: 0, y: 0 }); s.vertices = [[0, 0], [10, 0], [10, 5], [0, 5], [0.05, 0.04]].map(([x, y]) => ({ x, y })); s.segments = [0, 1, 2, 3].map(() => newSegment('line')); c.shapes.push(s);
  const lv = looseVertices(c, 0.2); assert.equal(lv.ends.length, 2); assert.ok(lv.pairs.length >= 1);
  const r = mergeVertices(c, { shapeId: s.id, i: 0 }, { shapeId: s.id, i: 4 }, 'first');
  assert.equal(r.result, 'closed'); assert.ok(s.closed); assert.equal(s.vertices.length, 4); assert.equal(segmentCount(s), 4); near(shapeArea(s), 50, 1e-6);
  assert.equal(looseVertices(c, 0.2).ends.length, 0); console.log('ok close by merge'); }
// emendar duas formas abertas
{ const c = newContent('m'); const a = newShape({ x: 0, y: 0 }); a.vertices = [[0, 0], [10, 0], [10, 5]].map(([x, y]) => ({ x, y })); a.segments = [newSegment(), newSegment()];
  const b = newShape({ x: 0, y: 0 }); b.vertices = [[0, 0.02], [0, 5], [10.03, 5]].map(([x, y]) => ({ x, y })); b.segments = [newSegment(), newSegment()]; c.shapes.push(a, b);
  let r = mergeVertices(c, { shapeId: a.id, i: 2 }, { shapeId: b.id, i: 2 });
  // As outras pontas também se tocam (0,0)~(0,0.02) → emenda e já fecha.
  assert.equal(r.result, 'joined-closed'); assert.equal(c.shapes.length, 1); assert.ok(a.closed); assert.equal(a.vertices.length, 4); assert.equal(segmentCount(a), 4);
  near(shapeArea(a), 50, 0.2); console.log('ok join shapes'); }
// emendar sem fechar
{ const c = newContent('m'); const a = newShape({ x: 0, y: 0 }); a.vertices = [[0, 0], [10, 0]].map(([x, y]) => ({ x, y })); a.segments = [newSegment()];
  const b = newShape({ x: 0, y: 0 }); b.vertices = [[10.02, 0], [10, 5]].map(([x, y]) => ({ x, y })); b.segments = [newSegment()]; c.shapes.push(a, b);
  const r = mergeVertices(c, { shapeId: a.id, i: 1 }, { shapeId: b.id, i: 0 }); assert.equal(r.result, 'joined'); assert.equal(a.vertices.length, 3); assert.ok(!a.closed); console.log('ok join open'); }
// closeShape
{ const s = newShape({ x: 0, y: 0 }); s.vertices = [[0, 0], [4, 0], [4, 3]].map(([x, y]) => ({ x, y })); s.segments = [newSegment(), newSegment()]; closeShape(s); assert.equal(segmentCount(s), 3); near(shapeArea(s), 6); console.log('ok closeShape'); }

// ---- "Unir pontos quase juntos": fonte única (joinClusters) + topologia religada ----
{ const { joinClusters, joinAll, joinCandidates } = await import('../js/model.js');
  const P = (pts) => pts.map(([x, y]) => ({ x, y, angleMode: 'auto' }));
  // 2 pontos: forma aberta com as pontas quase juntas → 1 grupo; Unir fecha de verdade.
  { const c = newContent('m'); const s = newShape({ x: 0, y: 0 }); s.vertices = P([[0, 0], [10, 0], [10, 5], [0, 5], [0.08, -0.06]]); s.segments = [0, 1, 2, 3].map(() => newSegment()); c.shapes.push(s);
    assert.equal(joinClusters(c, 0.2).length, 1);
    const r = joinAll(c, 0.2);
    assert.equal(r.groups, 1); assert.ok(s.closed); assert.equal(s.vertices.length, 4); assert.equal(segmentCount(s), 4);
    assert.equal(joinClusters(c, 0.2).length, 0, 'depois de unir não sobra alerta');
    assert.equal(looseVertices(c, 0).ends.length, 0); console.log('ok unir 2 pontos'); }
  // Pontas sobrepostas (d=0) mas desligadas também contam — era o "não há nada para unir".
  { const c = newContent('m'); const s = newShape({ x: 0, y: 0 }); s.vertices = P([[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]]); s.segments = [0, 1, 2, 3].map(() => newSegment()); c.shapes.push(s);
    assert.equal(joinClusters(c, 0.2).length, 1); joinAll(c, 0.2); assert.ok(s.closed); console.log('ok unir sobrepostos'); }
  // 3 traços que formam um triângulo: 3 grupos de 2 → um contorno fechado.
  { const c = newContent('m'); const mk = (pts) => { const s = newShape({ x: 0, y: 0 }); s.vertices = P(pts); s.segments = [newSegment()]; c.shapes.push(s); return s; };
    mk([[0, 0], [10, 0]]); mk([[10.05, 0.03], [5, 8]]); mk([[5.04, 8.05], [0.06, -0.02]]);
    assert.equal(joinClusters(c, 0.2).length, 3);
    const r = joinAll(c, 0.2);
    assert.equal(r.groups, 3); assert.equal(c.shapes.length, 1); assert.ok(c.shapes[0].closed); assert.equal(c.shapes[0].vertices.length, 3);
    assert.equal(joinClusters(c, 0.2).length, 0); console.log('ok unir 3 traços'); }
  // 3 pontos no mesmo lugar: U aberto (2 pontas) + traço solto → 1 grupo; fecha e a ponta do traço encosta.
  { const c = newContent('m'); const u = newShape({ x: 0, y: 0 }); u.vertices = P([[0, 0], [10, 0], [10, 5], [0, 5], [0.1, 0.05]]); u.segments = [0, 1, 2, 3].map(() => newSegment()); c.shapes.push(u);
    const t = newShape({ x: 0, y: 0 }); t.vertices = P([[-4, -4], [-0.05, 0.08]]); t.segments = [newSegment()]; c.shapes.push(t);
    const cl = joinClusters(c, 0.2); assert.equal(cl.length, 1); assert.equal(cl[0].members.length, 3);
    joinAll(c, 0.2);
    assert.ok(u.closed); assert.equal(u.vertices.length, 4);
    near(dist(t.vertices[1], u.vertices[0]), 0, 1e-9);
    assert.equal(joinClusters(c, 0.2).length, 0); console.log('ok unir 3 pontos'); }
  // Ponta encostando no meio do próprio traço ("6"): vira laço fechado + cauda aberta.
  { const c = newContent('m'); const s = newShape({ x: 0, y: 0 }); s.vertices = P([[-5, 0], [0, 0], [10, 0], [10, 5], [0, 5], [0.05, 0.05]]); s.segments = [0, 1, 2, 3, 4].map(() => newSegment()); c.shapes.push(s);
    assert.equal(joinCandidates(c, 0.2)[0].kind, 'closeAt');
    joinAll(c, 0.2);
    assert.ok(s.closed); assert.equal(s.vertices.length, 4); near(shapeArea(s), 50, 0.6);
    assert.equal(c.shapes.length, 2); assert.equal(c.shapes[1].vertices.length, 2); console.log('ok unir em 6'); }
  // Áreas fechadas com cantos próximos NÃO são alerta (são independentes).
  { const c = newContent('m'); const a = rect(); const b = rect(); b.vertices.forEach((v) => { v.x += 10.05; }); c.shapes.push(a, b);
    assert.equal(joinClusters(c, 0.2).length, 0); console.log('ok áreas independentes'); }
}
