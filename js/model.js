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

// ---------- Pontos quase juntos: FONTE ÚNICA (anel, chip "Unir" e a ação usam isto) ----------
// Só conta o que dá para ligar de verdade — sempre envolve uma ponta de forma ABERTA:
//   close   pontas da mesma forma aberta            → fecha o contorno
//   join    pontas de duas formas abertas           → emenda numa forma só
//   closeAt ponta encostando num vértice da própria forma (desenho em "6") → laço fechado + cauda
//   attach  ponta encostando num vértice de outra forma → a ponta vai para o vértice
// Áreas fechadas com cantos próximos NÃO entram (são independentes). tol em unidades do mundo.
const KIND_ORDER = { close: 0, join: 1, closeAt: 2, attach: 3 };
const EPS = 1e-7;
export function joinCandidates(content, tol) {
  const out = [];
  const shapes = content.shapes.filter((s) => s.vertices.length >= 2);
  const ends = [];
  for (const s of shapes) if (!s.closed) ends.push({ s, i: 0 }, { s, i: s.vertices.length - 1 });
  const seen = new Set();
  for (const E of ends) {
    const pe = E.s.vertices[E.i];
    for (const s of shapes) {
      const n = s.vertices.length;
      for (let j = 0; j < n; j++) {
        if (s === E.s && j === E.i) continue;
        const d = dist(pe, s.vertices[j]);
        if (d > tol) continue;
        const otherIsEnd = !s.closed && (j === 0 || j === n - 1);
        let kind;
        if (s === E.s) {
          if (otherIsEnd) { if (n < 4) continue; kind = 'close'; }
          else {
            // laço de pelo menos 3 vértices e não vizinho da ponta
            const loop = E.i === 0 ? j : n - 1 - j;
            if (loop < 3) continue;
            kind = 'closeAt';
          }
        } else if (otherIsEnd) kind = 'join';
        else { if (d <= EPS) continue; kind = 'attach'; } // já encostado = ligado
        const ka = `${E.s.id}:${E.i}`, kb = `${s.id}:${j}`;
        const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ kind, d, a: { shapeId: E.s.id, i: E.i }, b: { shapeId: s.id, i: j }, anchorB: kind === 'attach' });
      }
    }
  }
  return out.sort((p, q) => KIND_ORDER[p.kind] - KIND_ORDER[q.kind] || p.d - q.d);
}

// Agrupa os pares em grupos (3 pontos quase juntos = 1 grupo). Cada grupo vira 1 anel e 1 união.
export function joinClusters(content, tol) {
  const pairs = joinCandidates(content, tol);
  const key = (r) => `${r.shapeId}:${r.i}`;
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
  for (const p of pairs) { add(key(p.a)); add(key(p.b)); parent.set(find(key(p.a)), find(key(p.b))); }
  const groups = new Map();
  for (const p of pairs) {
    const r = find(key(p.a));
    if (!groups.has(r)) groups.set(r, { members: new Map(), anchors: new Set(), pairs: [] });
    const g = groups.get(r);
    g.members.set(key(p.a), p.a); g.members.set(key(p.b), p.b); g.pairs.push(p);
    if (p.anchorB) g.anchors.add(key(p.b));
  }
  return [...groups.values()].map((g) => {
    const members = [...g.members.values()];
    // Vértices que não são pontas soltas (de formas já prontas) ficam parados: as pontas vão até eles.
    const anchors = members.filter((m) => g.anchors.has(key(m)) && !isOpenEnd(content, m));
    const base = anchors.length ? anchors : members;
    const pts = base.map((m) => findShape(content, m.shapeId).vertices[m.i]);
    const center = { x: pts.reduce((t, p) => t + p.x, 0) / pts.length, y: pts.reduce((t, p) => t + p.y, 0) / pts.length };
    return { members, center, pairs: g.pairs };
  });
}

function isOpenEnd(content, r) {
  const s = findShape(content, r.shapeId);
  return s && !s.closed && (r.i === 0 || r.i === s.vertices.length - 1);
}

// Une um grupo: leva todos os pontos ao centro e religa a topologia (fecha / emenda / laço).
// Devolve { ops, shapes:Set(ids tocados) }.
export function joinCluster(content, cluster) {
  const touched = new Set();
  for (const m of cluster.members) {
    const s = findShape(content, m.shapeId);
    if (!s) continue;
    s.vertices[m.i].x = cluster.center.x; s.vertices[m.i].y = cluster.center.y;
    touched.add(s.id);
  }
  let ops = 0, guard = 0;
  while (guard++ < 100) {
    const p = joinCandidates(content, 1e-9).find((q) => q.kind !== 'attach' && dist(findShape(content, q.a.shapeId).vertices[q.a.i], cluster.center) < 1e-6);
    if (!p) break;
    const r = p.kind === 'closeAt' ? closeAtVertex(content, p.a, p.b) : mergeVertices(content, p.a, p.b, 'first');
    if (!r || r.result === 'moved') break;
    ops++;
    touched.add(r.shape.id);
    for (const t of r.created || []) touched.add(t.id);
  }
  for (const id of [...touched]) if (!findShape(content, id)) touched.delete(id);
  return { ops, shapes: touched };
}

// Une TODOS os grupos (o botão "Unir" do chip). Devolve { groups, shapes }.
export function joinAll(content, tol) {
  let groups = 0, guard = 0;
  const shapes = new Set();
  while (guard++ < 50) {
    const cl = joinClusters(content, tol)[0];
    if (!cl) break;
    const r = joinCluster(content, cl);
    r.shapes.forEach((id) => shapes.add(id));
    groups++;
  }
  for (const id of [...shapes]) if (!findShape(content, id)) shapes.delete(id);
  return { groups, shapes };
}

// Ponta E de uma forma aberta encosta no vértice J da mesma forma: separa o laço (fechado,
// fica com a identidade/preenchimento) e a cauda (forma aberta nova, se tiver lado).
export function closeAtVertex(content, E, J) {
  const s = findShape(content, E.shapeId);
  if (!s || s.closed) return null;
  let j = J.i;
  if (E.i === 0) { reverseShape(s); j = s.vertices.length - 1 - j; }
  const n = s.vertices.length;
  if (n - 1 - j < 3) return null;
  const tailV = s.vertices.slice(0, j + 1), tailS = s.segments.slice(0, j);
  s.vertices = s.vertices.slice(j, n - 1);
  s.segments = s.segments.slice(j, n - 1);
  s.closed = true;
  const created = [];
  if (tailV.length >= 2) {
    const t = { ...newShape(tailV[0]), vertices: tailV.map((v) => ({ ...v })), segments: tailS.map((g) => ({ ...g })) };
    content.shapes.push(t);
    created.push(t);
  }
  return { result: 'closed', shape: s, created };
}

// Compatível com o detector antigo: pontas abertas que NÃO estão ligadas a nada + pares.
export function looseVertices(content, tol) {
  const pairs = joinCandidates(content, tol).map((p) => [p.a, p.b]);
  const ends = [];
  for (const s of content.shapes) {
    if (s.closed || s.vertices.length < 2) continue;
    for (const i of [0, s.vertices.length - 1]) {
      const p = s.vertices[i];
      const linked = content.shapes.some((o) => o.vertices.some((q, j) => !(o === s && j === i) && dist(p, q) <= EPS));
      if (!linked) ends.push({ shapeId: s.id, i, kind: 'open' });
    }
  }
  return { ends, pairs };
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
