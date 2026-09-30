// Estrutura de dados do croqui + operações. Os dois modos de desenho geram a MESMA estrutura.
//
// content = { version, unit:'ft'|'m', calibrated:bool, shapes:[Shape], texts:[Text] }
// Shape   = { id, name, closed, fill|null,
//             vertices:[{x,y, angleMode:'auto'|'right'|'free'|'fixed', angle?}],
//             segments:[{type:'line'|'arc', bulge, length:null|m, sagitta?:null|m}] }
// Text    = { id, x, y, w, size, text }   (mundo: metros)
import { uid } from './util.js';
import { solveShape } from './solver.js';
import { objectArea } from './objects.js';
import { polygonize, pointInPolygon, shapeArea, shapePerimeter, segmentCount, lerp, segInfo, add, mul, sub, dist, arcPoint, turnAngle } from './geometry.js';

export const newContent = (unit = 'ft') => ({ version: 1, unit, calibrated: false, shapes: [], texts: [], objects: [], images: [] });

export const newShape = (p) => ({
  id: uid(), name: '', closed: false, fill: null,
  vertices: [{ x: p.x, y: p.y, angleMode: 'auto' }],
  segments: [],
});

export const newSegment = (type = 'line', bulge = 0) => ({ type, bulge: type === 'arc' ? bulge || 0.35 : 0, length: null, sagitta: null });

export const hasMeasures = (shape) => shape.segments.some((s) => s.length != null);

// Resolve a forma e aplica. Na 1ª medida do croqui, reescala também o resto do desenho.
export function solveInContent(content, shape, opts) {
  const n = shape.vertices.length;
  const cx = shape.vertices.reduce((s, v) => s + v.x, 0) / (n || 1);
  const cy = shape.vertices.reduce((s, v) => s + v.y, 0) / (n || 1);
  const res = solveShape(shape, opts);
  if (!content.calibrated && hasMeasures(shape)) {
    const k = res.scale;
    const sc = (p) => { p.x = cx + (p.x - cx) * k; p.y = cy + (p.y - cy) * k; };
    for (const s of content.shapes) if (s !== shape) s.vertices.forEach(sc);
    for (const t of content.texts) { sc(t); t.w *= k; t.size *= k; }
    for (const o of content.objects || []) sc(o); // colunas mantêm o tamanho real, só a posição acompanha
    content.calibrated = true;
  }
  shape.vertices = res.vertices;
  shape.segments = res.segments;
  return res.report;
}

export function solveAll(content) {
  const reports = {};
  for (const s of content.shapes) reports[s.id] = hasMeasures(s) ? solveInContent(content, s) : null;
  return reports;
}

export function findShape(content, id) {
  return content.shapes.find((s) => s.id === id);
}

// Menor forma fechada que contém o ponto (piscina dentro do pátio → piscina).
export function shapeAt(content, p) {
  let best = null, ba = Infinity;
  for (const s of content.shapes) {
    if (!s.closed) continue;
    const poly = polygonize(s);
    if (pointInPolygon(p, poly)) {
      const a = shapeArea(s);
      if (a < ba) { ba = a; best = s; }
    }
  }
  return best;
}

function contains(outer, inner) {
  const poly = polygonize(outer);
  return inner.vertices.every((v) => pointInPolygon(v, poly));
}

// Estatísticas: área, perímetro, área líquida (descontando formas internas) e totais.
export function stats(content) {
  const closed = content.shapes.filter((s) => s.closed && s.vertices.length >= 3);
  const per = {};
  for (const s of content.shapes) per[s.id] = { area: shapeArea(s), perimeter: shapePerimeter(s), net: shapeArea(s), parent: null };
  for (const s of closed) {
    let parent = null, pa = Infinity;
    for (const o of closed) {
      if (o === s) continue;
      const a = per[o.id].area;
      if (a > per[s.id].area && a < pa && contains(o, s)) { parent = o; pa = a; }
    }
    per[s.id].parent = parent?.id ?? null;
  }
  for (const s of closed) if (per[s.id].parent) per[per[s.id].parent].net -= per[s.id].area;
  // Colunas marcadas para subtrair saem da área (líquida) da menor área fechada que as contém.
  let objArea = 0;
  for (const o of content.objects || []) {
    if (!o.subtract) continue;
    let host = null, ha = Infinity;
    for (const s of closed) {
      if (per[s.id].area < ha && pointInPolygon({ x: o.x, y: o.y }, polygonize(s))) { host = s; ha = per[s.id].area; }
    }
    if (!host) continue;
    const a = objectArea(o);
    per[host.id].net -= a;
    per[host.id].objArea = (per[host.id].objArea || 0) + a;
    objArea += a;
  }
  let area = 0, perimeter = 0;
  for (const s of closed) if (!per[s.id].parent) area += per[s.id].area;
  for (const s of content.shapes) perimeter += per[s.id].perimeter;
  return { per, area, areaNet: area - objArea, objArea, perimeter };
}

// ---------- Edição de paredes e vértices ----------

// Divide o segmento i no parâmetro t (0..1, ao longo do comprimento). Medidas são herdadas
// proporcionalmente até o usuário digitar outras. Funciona em retas e arcos.
export function splitSegment(shape, i, t = 0.5) {
  t = Math.min(0.95, Math.max(0.05, t));
  const info = segInfo(shape, i);
  const seg = shape.segments[i];
  let p, b1 = 0, b2 = 0;
  if (info.arc) {
    const th = 4 * Math.atan(seg.bulge);
    p = arcPoint(info.arc, t);
    b1 = Math.tan((th * t) / 4);
    b2 = Math.tan((th * (1 - t)) / 4);
  } else p = lerp(info.p0, info.p1, t);
  shape.vertices.splice(i + 1, 0, { x: p.x, y: p.y, angleMode: 'auto' });
  // Em arco a medida é a corda; a divisão proporcional é aproximada pela corda de cada parte.
  const c1 = dist(info.p0, p), c2 = dist(p, info.p1), ct = c1 + c2 || 1;
  const L = seg.length;
  const a = { ...seg, bulge: b1, length: L != null ? (L * (info.arc ? c1 / info.chord : t)) : null, sagitta: null };
  const bseg = { ...seg, bulge: b2, length: L != null ? (L * (info.arc ? c2 / info.chord : 1 - t)) : null, sagitta: null };
  void ct;
  shape.segments.splice(i, 1, a, bseg);
  return i + 1;
}

// Divide em N partes iguais (em comprimento de arco para arcos).
export function splitSegmentN(shape, i, n) {
  for (let k = n; k > 1; k--) splitSegment(shape, i + (n - k), 1 / k);
}

// Parâmetro t (0..1) do ponto do segmento mais próximo de p.
export function segmentParamAt(shape, i, p) {
  const info = segInfo(shape, i);
  if (!info.arc) {
    const d = sub(info.p1, info.p0), l2 = d.x * d.x + d.y * d.y || 1;
    return ((p.x - info.p0.x) * d.x + (p.y - info.p0.y) * d.y) / l2;
  }
  let best = 0.5, bd = Infinity;
  for (let k = 1; k < 40; k++) { const q = arcPoint(info.arc, k / 40); const d = dist(q, p); if (d < bd) { bd = d; best = k / 40; } }
  return best;
}

// Remove o vértice i unindo as duas paredes vizinhas. Se ambas tinham medida e eram quase
// colineares, a nova parede recebe a soma; senão fica sem medida (ou `length` informado).
export function removeVertex(content, shape, i, length) {
  const n = shape.vertices.length;
  const m = segmentCount(shape);
  const inIdx = shape.closed ? (i - 1 + n) % n : i - 1;
  const outIdx = i;
  const hasIn = inIdx >= 0 && inIdx < m, hasOut = outIdx < m;
  let merged = null;
  if (hasIn && hasOut) {
    const a = shape.segments[inIdx], b = shape.segments[outIdx];
    const straight = Math.abs(turnAngle(shape, i) ?? Math.PI) < (10 * Math.PI) / 180;
    merged = length ?? (a.length != null && b.length != null && straight ? a.length + b.length : null);
  }
  deleteVertex(content, shape, i);
  if (hasIn && hasOut && findShape(content, shape.id)) {
    const idx = shape.closed ? (i === 0 ? shape.vertices.length - 1 : i - 1) : i - 1;
    if (shape.segments[idx]) shape.segments[idx].length = merged;
  }
}

// Mescla o segmento i com o seguinte (remove o vértice entre eles).
export function mergeWithNext(content, shape, i, length) {
  const n = shape.vertices.length;
  const v = shape.closed ? (i + 1) % n : i + 1;
  if (!shape.closed && v >= n - 1) return false; // não há parede depois
  removeVertex(content, shape, v, length);
  return true;
}
export function mergeWithPrev(content, shape, i, length) {
  if (!shape.closed && i === 0) return false;
  removeVertex(content, shape, i, length);
  return true;
}

// Remove vértices quase colineares (só entre retas). Devolve quantos saíram.
export function simplifyShape(content, shape, tolDeg = 4) {
  let removed = 0, again = true;
  while (again && shape.vertices.length > 3) {
    again = false;
    const n = shape.vertices.length;
    for (let i = 0; i < n; i++) {
      if (!shape.closed && (i === 0 || i === n - 1)) continue;
      const a = shape.segments[shape.closed ? (i - 1 + n) % n : i - 1], b = shape.segments[i];
      if (!a || !b || a.type === 'arc' || b.type === 'arc') continue;
      const t = turnAngle(shape, i);
      if (t != null && Math.abs(t) < (tolDeg * Math.PI) / 180) { removeVertex(content, shape, i); removed++; again = true; break; }
    }
  }
  return removed;
}

// Fecha o contorno. No modelo aberto, v0..v(n-1) têm n-1 segmentos; no fechado, n vértices têm n.
// Se as pontas já estão sobrepostas, a última vira o próprio v0 (o último segmento passa a fechar).
export function closeShape(shape) {
  if (shape.closed || shape.vertices.length < 3) return false;
  const a = shape.vertices[0], z = shape.vertices[shape.vertices.length - 1];
  if (dist(a, z) < 1e-3 * (1 + shapePerimeter(shape)) && shape.vertices.length >= 4) shape.vertices.pop();
  else shape.segments.push(newSegment('line'));
  shape.closed = true;
  return true;
}

export function deleteVertex(content, shape, i) {
  const n = shape.vertices.length;
  if (n <= 2) { content.shapes = content.shapes.filter((s) => s !== shape); return; }
  shape.vertices.splice(i, 1);
  if (shape.closed) {
    shape.segments.splice(i, 1);
    const idx = i === 0 ? n - 2 : i - 1;
    shape.segments[idx] = { ...shape.segments[idx], length: null, type: 'line', bulge: 0 };
    if (shape.vertices.length < 3) { shape.closed = false; shape.segments = shape.segments.slice(0, shape.vertices.length - 1); }
  } else if (i === 0) shape.segments.splice(0, 1);
  else if (i === n - 1) shape.segments.splice(n - 2, 1);
  else {
    shape.segments.splice(i, 1);
    shape.segments[i - 1] = { ...shape.segments[i - 1], length: null, type: 'line', bulge: 0 };
  }
}

// Une dois vértices (da mesma forma ou de formas abertas diferentes) num só.
// mode: 'avg' (posição média) | 'first' (fica na posição do primeiro).
export function mergeVertices(content, A, B, mode = 'avg') {
  const sa = findShape(content, A.shapeId), sb = findShape(content, B.shapeId);
  const pa = sa.vertices[A.i], pb = sb.vertices[B.i];
  const P = mode === 'first' ? { x: pa.x, y: pa.y } : { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  if (sa === sb) {
    const n = sa.vertices.length;
    const ends = !sa.closed && ((A.i === 0 && B.i === n - 1) || (B.i === 0 && A.i === n - 1));
    if (ends) {
      // Remove a ponta final: o último segmento passa a terminar em v0 = fechamento.
      sa.vertices[0].x = P.x; sa.vertices[0].y = P.y;
      sa.vertices.pop();
      sa.closed = true;
      return { result: 'closed', shape: sa };
    }
    const adjacent = Math.abs(A.i - B.i) === 1 || (sa.closed && Math.abs(A.i - B.i) === n - 1);
    if (adjacent) {
      const keep = Math.min(A.i, B.i) === 0 && Math.max(A.i, B.i) === n - 1 ? n - 1 : Math.min(A.i, B.i);
      const drop = keep === n - 1 ? 0 : keep + 1;
      sa.vertices[keep].x = P.x; sa.vertices[keep].y = P.y;
      deleteVertex(content, sa, drop);
      return { result: 'merged', shape: sa };
    }
    // Não vizinhos na mesma forma: só sobrepõe (a topologia não permite fundir sem cortar a forma).
    pa.x = pb.x = P.x; pa.y = pb.y = P.y;
    return { result: 'moved', shape: sa };
  }
  // Formas diferentes: só dá para emendar pontas de formas abertas.
  const endA = !sa.closed && (A.i === 0 || A.i === sa.vertices.length - 1);
  const endB = !sb.closed && (B.i === 0 || B.i === sb.vertices.length - 1);
  if (endA && endB) {
    if (A.i === 0) reverseShape(sa);          // A passa a ser a ponta final de sa
    if (B.i !== 0) reverseShape(sb);          // B passa a ser a ponta inicial de sb
    const last = sa.vertices[sa.vertices.length - 1];
    last.x = P.x; last.y = P.y;
    sa.vertices.push(...sb.vertices.slice(1).map((v) => ({ ...v })));
    sa.segments.push(...sb.segments.map((g) => ({ ...g })));
    content.shapes = content.shapes.filter((s) => s !== sb);
    // Se as outras pontas também coincidem, fecha.
    const f = sa.vertices[0], z = sa.vertices[sa.vertices.length - 1];
    if (sa.vertices.length >= 4 && dist(f, z) < 1e-6 + 1e-3 * shapePerimeter(sa)) { sa.vertices.pop(); sa.closed = true; return { result: 'joined-closed', shape: sa }; }
    return { result: 'joined', shape: sa };
  }
  pa.x = pb.x = P.x; pa.y = pb.y = P.y;
  return { result: 'moved', shape: sa };
}

// Inverte o sentido de uma forma ABERTA (arcos trocam o lado do bulge para manter a curva).
export function reverseShape(shape) {
  shape.vertices.reverse();
  shape.segments = shape.segments.slice().reverse().map((g) => ({ ...g, bulge: -(g.bulge || 0), sagitta: g.sagitta != null ? -g.sagitta : null }));
}

// Detector de pontas soltas: extremidades de formas abertas + pares de vértices de formas
// diferentes muito próximos (parecem ligados mas não estão). tol em unidades do mundo.
export function looseVertices(content, tol) {
  const out = [];
  const ends = [];
  for (const s of content.shapes) {
    if (!s.closed && s.vertices.length >= 2) {
      ends.push({ shapeId: s.id, i: 0 }, { shapeId: s.id, i: s.vertices.length - 1 });
    }
  }
  for (const e of ends) out.push({ ...e, kind: 'open' });
  const all = content.shapes.flatMap((s) => s.vertices.map((v, i) => ({ shapeId: s.id, i, v, s })));
  const pairs = [];
  for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) {
    const A = all[a], B = all[b];
    const d = dist(A.v, B.v);
    if (d > tol) continue;
    if (A.shapeId === B.shapeId) {
      const n = A.s.vertices.length;
      const adj = Math.abs(A.i - B.i) === 1 || (A.s.closed && Math.abs(A.i - B.i) === n - 1);
      const ends2 = !A.s.closed && ((A.i === 0 && B.i === n - 1) || (B.i === 0 && A.i === n - 1));
      if (!(adj || ends2) && d > tol * 0.02) continue;
      if (adj && d > tol * 0.5) continue; // parede curta de verdade
    }
    pairs.push([{ shapeId: A.shapeId, i: A.i }, { shapeId: B.shapeId, i: B.i }]);
  }
  return { ends: out, pairs };
}

// Exclui a parede i. Fechado → vira aberto começando depois dela. Aberto → divide em dois.
export function deleteSegment(content, shape, i) {
  const n = shape.vertices.length;
  if (shape.closed) {
    const order = [];
    for (let k = 1; k <= n; k++) order.push((i + k) % n);
    const segs = [];
    for (let k = 1; k < n; k++) segs.push(shape.segments[(i + k) % n]);
    shape.vertices = order.map((j) => shape.vertices[j]);
    shape.segments = segs;
    shape.closed = false;
    shape.fill = null;
    return;
  }
  const left = { vertices: shape.vertices.slice(0, i + 1), segments: shape.segments.slice(0, i) };
  const right = { vertices: shape.vertices.slice(i + 1), segments: shape.segments.slice(i + 1) };
  shape.vertices = left.vertices; shape.segments = left.segments;
  const out = [];
  if (right.vertices.length >= 2) {
    const s2 = { ...newShape(right.vertices[0]), vertices: right.vertices, segments: right.segments };
    content.shapes.push(s2);
    out.push(s2);
  }
  if (shape.vertices.length < 2) content.shapes = content.shapes.filter((x) => x !== shape);
  return out;
}

export function moveShape(shape, d) {
  shape.vertices.forEach((v) => { v.x += d.x; v.y += d.y; });
}

export function contentBounds(content) {
  const pts = [];
  for (const s of content.shapes) pts.push(...polygonize(s));
  for (const t of content.texts) pts.push({ x: t.x, y: t.y }, { x: t.x + t.w, y: t.y + t.size * 4 });
  return pts;
}

export { segmentCount, add, mul };
