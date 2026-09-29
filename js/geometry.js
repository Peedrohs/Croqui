// Geometria pura. Mundo em metros, eixo y para baixo (igual à tela).
// Uma forma = { vertices:[{x,y,...}], segments:[{type:'line'|'arc', bulge, ...}], closed }
// O segmento i liga o vértice i ao vértice i+1 (mod n se fechado).
// Arcos: bulge = tan(θ/4); flecha = bulge·corda/2, no sentido da normal (-dy, dx).

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const segmentCount = (s) => (s.closed ? s.vertices.length : Math.max(0, s.vertices.length - 1));
export const segEnds = (s, i) => [s.vertices[i], s.vertices[(i + 1) % s.vertices.length]];

export function arcInfo(p0, p1, bulge) {
  const d = sub(p1, p0);
  const c = len(d);
  if (!bulge || Math.abs(bulge) < 1e-6 || c < 1e-12) return null;
  const nrm = { x: -d.y / c, y: d.x / c };
  const mid = lerp(p0, p1, 0.5);
  const s = (bulge * c) / 2;
  const M = add(mid, mul(nrm, s));
  const theta = 4 * Math.atan(bulge);
  const r = (c * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const C = sub(M, mul(nrm, Math.sign(bulge) * r));
  const a0 = Math.atan2(p0.y - C.y, p0.x - C.x);
  return { C, r, theta, a0, M, chord: c, sagitta: s, nrm, length: r * Math.abs(theta) };
}

export function arcPoint(info, t) {
  const a = info.a0 - t * info.theta;
  return { x: info.C.x + info.r * Math.cos(a), y: info.C.y + info.r * Math.sin(a) };
}

export function segInfo(shape, i) {
  const [p0, p1] = segEnds(shape, i);
  const seg = shape.segments[i];
  const arc = seg && seg.type === 'arc' ? arcInfo(p0, p1, seg.bulge) : null;
  const chord = dist(p0, p1);
  return { p0, p1, arc, chord, length: arc ? arc.length : chord, mid: arc ? arc.M : lerp(p0, p1, 0.5) };
}

// Pontos de uma polilinha que aproxima o segmento (sem o ponto final).
export function segPoints(shape, i, step = Math.PI / 24) {
  const { p0, arc } = segInfo(shape, i);
  if (!arc) return [p0];
  const n = Math.max(2, Math.ceil(Math.abs(arc.theta) / step));
  const pts = [];
  for (let k = 0; k < n; k++) pts.push(arcPoint(arc, k / n));
  return pts;
}

export function polygonize(shape, step) {
  const pts = [];
  const m = segmentCount(shape);
  for (let i = 0; i < m; i++) pts.push(...segPoints(shape, i, step));
  if (!shape.closed && shape.vertices.length) pts.push(shape.vertices[shape.vertices.length - 1]);
  return pts;
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function shapeArea(shape) {
  if (!shape.closed || shape.vertices.length < 2) return 0;
  return Math.abs(signedArea(polygonize(shape, Math.PI / 90)));
}

export function shapePerimeter(shape) {
  let p = 0;
  for (let i = 0, m = segmentCount(shape); i < m; i++) p += segInfo(shape, i).length;
  return p;
}

export function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / (pts.length || 1), y: s.y / (pts.length || 1) };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSegment(p, a, b) {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return dist(p, add(a, mul(d, t)));
}

// Ângulo de giro no vértice i (entre a corda que chega e a que sai). null se não existir.
export function turnAngle(shape, i) {
  const n = shape.vertices.length;
  if (!shape.closed && (i === 0 || i === n - 1)) return null;
  if (n < 3) return null;
  const a = shape.vertices[(i - 1 + n) % n], b = shape.vertices[i], c = shape.vertices[(i + 1) % n];
  const u = sub(b, a), v = sub(c, b);
  return Math.atan2(cross(u, v), dot(u, v));
}

export function orientation(shape) {
  if (!shape.closed) return 1;
  return signedArea(polygonize(shape)) >= 0 ? 1 : -1;
}

// Ângulo interno (graus) no vértice i, considerando a orientação do polígono.
export function interiorAngleDeg(shape, i) {
  const t = turnAngle(shape, i);
  if (t == null) return null;
  return ((Math.PI - orientation(shape) * t) * 180) / Math.PI;
}

// Ponto bom para rótulo: centróide se estiver bem dentro; senão, o ponto interno
// (amostrado numa grade) mais distante das bordas — resolve formas em L/U.
export function labelPoint(pts) {
  const c = centroid(pts);
  const edgeDist = (p) => {
    let m = Infinity;
    for (let i = 0, n = pts.length; i < n; i++) m = Math.min(m, distToSegment(p, pts[i], pts[(i + 1) % n]));
    return m;
  };
  const b = bbox(pts);
  const size = Math.min(b.w, b.h);
  if (pointInPolygon(c, pts) && edgeDist(c) > size * 0.25) return c;
  let best = c, bd = pointInPolygon(c, pts) ? edgeDist(c) : -1;
  const N = 24;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p = { x: b.x0 + (b.w * i) / N, y: b.y0 + (b.h * j) / N };
    if (!pointInPolygon(p, pts)) continue;
    const d = edgeDist(p);
    if (d > bd) { bd = d; best = p; }
  }
  return best;
}
