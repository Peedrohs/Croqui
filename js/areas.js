// Áreas encostadas: encaixe magnético aresta-com-aresta e divisa compartilhada oculta.
// As áreas continuam independentes (cada uma com o seu contorno, área e rótulo) — isto só
// alinha a posição e decide o que DESENHAR na divisa.
import { sub, add, mul, dot, cross, dist, norm, segmentCount, expandFillets, wrapAngle } from './geometry.js';

const DEG = Math.PI / 180;

// Paredes retas de uma forma (já com cantos arredondados expandidos).
function lineEdges(shape, expanded = true) {
  const sh = expanded ? expandFillets(shape) : shape;
  const n = sh.vertices.length, out = [];
  for (let j = 0, m = segmentCount(sh); j < m; j++) {
    if (sh.segments[j].type === 'arc') continue;
    const a = sh.vertices[j], b = sh.vertices[(j + 1) % n];
    const L = dist(a, b);
    if (L < 1e-9) continue;
    out.push({ j, a, b, L, u: { x: (b.x - a.x) / L, y: (b.y - a.y) / L } });
  }
  return out;
}

function bboxOf(shape) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of shape.vertices) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
}
const near = (A, B, e) => A.x0 <= B.x1 + e && B.x0 <= A.x1 + e && A.y0 <= B.y1 + e && B.y0 <= A.y1 + e;

// Trechos coincidentes entre paredes de áreas fechadas diferentes.
// Devolve Map "shapeId:índiceExpandido" → [[t0, t1], …] (fração ao longo da parede).
export function sharedEdges(content, eps) {
  const out = new Map();
  const closed = content.shapes.filter((s) => s.closed && s.vertices.length >= 3);
  const E = closed.map((s) => ({ s, b: bboxOf(s), e: lineEdges(s) }));
  const push = (id, j, t0, t1) => {
    const k = id + ':' + j;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push([t0, t1]);
  };
  for (let p = 0; p < E.length; p++) for (let q = p + 1; q < E.length; q++) {
    if (!near(E[p].b, E[q].b, eps)) continue;
    for (const ea of E[p].e) for (const eb of E[q].e) {
      if (Math.abs(cross(ea.u, eb.u)) > 0.01) continue;
      const nA = { x: -ea.u.y, y: ea.u.x };
      if (Math.abs(dot(sub(eb.a, ea.a), nA)) > eps || Math.abs(dot(sub(eb.b, ea.a), nA)) > eps) continue;
      const ta0 = dot(sub(eb.a, ea.a), ea.u) / ea.L, ta1 = dot(sub(eb.b, ea.a), ea.u) / ea.L;
      const lo = Math.max(0, Math.min(ta0, ta1)), hi = Math.min(1, Math.max(ta0, ta1));
      if ((hi - lo) * ea.L <= eps) continue;
      push(E[p].s.id, ea.j, lo, hi);
      const tb0 = dot(sub(ea.a, eb.a), eb.u) / eb.L, tb1 = dot(sub(ea.b, eb.a), eb.u) / eb.L;
      const lo2 = Math.max(0, Math.min(tb0, tb1)), hi2 = Math.min(1, Math.max(tb0, tb1));
      if (hi2 > lo2) push(E[q].s.id, eb.j, lo2, hi2);
    }
  }
  return out;
}

// Une intervalos sobrepostos e devolve os trechos VISÍVEIS (complemento em [0,1]).
export function visiblePieces(intervals) {
  const iv = intervals.map(([a, b]) => [Math.max(0, a), Math.min(1, b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  let t = 0;
  for (const [a, b] of iv) {
    if (a > t) out.push([t, a]);
    t = Math.max(t, b);
  }
  if (t < 1) out.push([t, 1]);
  return out.filter(([a, b]) => b - a > 1e-6);
}

export const hiddenFraction = (intervals) => 1 - visiblePieces(intervals || []).reduce((s, [a, b]) => s + b - a, 0);

/**
 * Encaixe magnético de uma área arrastada nas paredes das outras.
 * Procura um par de paredes quase paralelas (≤ angTol) e próximas (≤ tol): gira a área até ficarem
 * paralelas e encosta (coincidentes). Se as pontas ficarem perto, alinha canto com canto também.
 * Devolve { rot, pivot, d, edge:[p0,p1], key } ou null (longe = solto).
 */
export function edgeSnap(content, shape, tol, angTol = 8 * DEG) {
  const mine = lineEdges(shape, false);
  if (!mine.length) return null;
  const B = bboxOf(shape);
  let best = null;
  for (const o of content.shapes) {
    if (o === shape || o.vertices.length < 2) continue;
    if (!near(B, bboxOf(o), tol)) continue;
    for (const f of lineEdges(o)) {
      const nF = { x: -f.u.y, y: f.u.x };
      for (const e of mine) {
        let da = wrapAngle(Math.atan2(f.u.y, f.u.x) - Math.atan2(e.u.y, e.u.x));
        if (da > Math.PI / 2) da -= Math.PI; else if (da < -Math.PI / 2) da += Math.PI;
        if (Math.abs(da) > angTol) continue;
        const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
        const dperp = dot(sub(mid, f.a), nF);
        if (Math.abs(dperp) > tol) continue;
        // Precisa haver sobreposição (ou quase) ao longo da parede.
        const ta = dot(sub(e.a, f.a), f.u), tb = dot(sub(e.b, f.a), f.u);
        const lo = Math.min(ta, tb), hi = Math.max(ta, tb);
        if (hi < -tol || lo > f.L + tol) continue;
        const score = Math.abs(dperp) + Math.abs(da) * e.L * 0.25;
        if (!best || score < best.score) best = { score, e, f, da, mid, dperp, nF, key: o.id + ':' + f.j + '|' + e.j };
      }
    }
  }
  if (!best) return null;
  const { e, f, da, mid, dperp, nF } = best;
  let d = mul(nF, -dperp);
  // Depois de girar e encostar, alinha pontas próximas (canto com canto).
  const rot = (p) => { const c = Math.cos(da), s = Math.sin(da), q = sub(p, mid); return { x: mid.x + q.x * c - q.y * s, y: mid.y + q.x * s + q.y * c }; };
  const ea = add(rot(e.a), d), eb = add(rot(e.b), d);
  let bestShift = null;
  for (const p of [ea, eb]) for (const q of [f.a, f.b]) {
    const s = dot(sub(q, p), f.u);
    if (Math.abs(s) < tol && (bestShift == null || Math.abs(s) < Math.abs(bestShift))) bestShift = s;
  }
  if (bestShift != null) d = add(d, mul(f.u, bestShift));
  return { rot: da, pivot: mid, d, edge: [f.a, f.b], key: best.key, corner: bestShift != null };
}

export function applyRigid(vertices, orig, r) {
  const c = Math.cos(r.rot), s = Math.sin(r.rot);
  orig.forEach((p, i) => {
    const q = sub(p, r.pivot);
    vertices[i].x = r.pivot.x + q.x * c - q.y * s + r.d.x;
    vertices[i].y = r.pivot.y + q.x * s + q.y * c + r.d.y;
  });
}

// Parede arrastada (paralela): encaixa na linha de uma parede paralela de outra forma.
// Devolve o deslocamento ao longo da normal que torna as duas colineares, ou null.
export function wallSnapOffset(content, shape, a, b, nrm, tol) {
  const L = dist(a, b);
  if (L < 1e-9) return null;
  const u = norm(sub(b, a));
  let best = null;
  for (const o of content.shapes) {
    if (o === shape) continue;
    for (const f of lineEdges(o)) {
      if (Math.abs(cross(u, f.u)) > Math.sin(1.5 * DEG)) continue;
      const off = dot(sub(f.a, a), nrm);
      if (Math.abs(off) > tol) continue;
      const ta = dot(sub(f.a, a), u), tb = dot(sub(f.b, a), u);
      if (Math.max(ta, tb) < -tol || Math.min(ta, tb) > L + tol) continue;
      if (!best || Math.abs(off) < Math.abs(best.off)) best = { off, edge: [f.a, f.b], key: o.id + ':' + f.j };
    }
  }
  return best;
}

// Vértice perto de uma parede de outra forma: projeta sobre ela.
export function pointOnEdgeSnap(content, p, tol, skip) {
  let best = null;
  for (const o of content.shapes) {
    for (const f of lineEdges(o)) {
      if (skip?.(o, f)) continue;
      const t = dot(sub(p, f.a), f.u);
      if (t < 0 || t > f.L) continue;
      const q = add(f.a, mul(f.u, t));
      const d = dist(p, q);
      if (d < tol && (!best || d < best.d)) best = { d, q, edge: [f.a, f.b], key: o.id + ':' + f.j };
    }
  }
  return best;
}
