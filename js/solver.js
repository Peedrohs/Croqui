// Solver de restrições por mínimos quadrados (Levenberg–Marquardt, Jacobiano numérico).
//
// Variáveis: coordenadas (x,y) de todos os vértices de uma forma.
// Resíduos (ponderados):
//   • comprimento medido de cada segmento (corda)            — quase rígido
//   • ângulo reto / colinear detectado (ou fixado pelo usuário) — forte
//   • paralelismo detectado entre segmentos retos             — médio
//   • ângulo do esboço preservado                             — fraco
//   • âncora nas posições iniciais (remove translação/rotação) — muito fraco
// Segmentos sem medida ficam livres para absorver o erro de fechamento.

import { arcInfo, dist, segmentCount, sub, cross, dot, wrapAngle, signedArea, polygonize } from './geometry.js';

const W_LEN = 100;
const W_SNAP = 40;
const W_PAR = 15;
const W_KEEP = 1.5;
const W_GAUGE = 0.03;
const DEG = Math.PI / 180;

export const TOL_ANGLE_DEG = 0.5;
export const lengthTolerance = (L) => Math.max(0.003, 0.002 * L);

// Corda-alvo de um segmento medido.
function chordTarget(seg) {
  if (seg.length == null) return null;
  return seg.length;
}

function detectAngleTargets(shape, X) {
  const n = shape.vertices.length;
  const P = (i) => ({ x: X[2 * i], y: X[2 * i + 1] });
  const orient = shape.closed ? (signedArea(polygonize(shape)) >= 0 ? 1 : -1) : 1;
  const targets = [];
  for (let i = 0; i < n; i++) {
    if (!shape.closed && (i === 0 || i === n - 1)) continue;
    if (n < 3) continue;
    const v = shape.vertices[i];
    const a = P((i - 1 + n) % n), b = P(i), c = P((i + 1) % n);
    const u = sub(b, a), w = sub(c, b);
    const phi = Math.atan2(cross(u, w), dot(u, w));
    const mode = v.angleMode || 'auto';
    if (mode === 'free') continue;
    if (mode === 'fixed' && v.angle != null) {
      targets.push({ i, target: wrapAngle(orient * (Math.PI - v.angle * DEG)), w: W_SNAP, hard: true });
      continue;
    }
    if (mode === 'right') {
      targets.push({ i, target: Math.sign(phi || 1) * Math.PI / 2, w: W_SNAP, hard: true });
      continue;
    }
    const ab = Math.abs(phi);
    if (Math.abs(ab - Math.PI / 2) < 9 * DEG) targets.push({ i, target: Math.sign(phi) * Math.PI / 2, w: W_SNAP, hard: true, auto: true });
    else if (ab < 6 * DEG) targets.push({ i, target: 0, w: W_SNAP, hard: true, auto: true });
    else if (Math.abs(ab - Math.PI / 4) < 4 * DEG) targets.push({ i, target: Math.sign(phi) * Math.PI / 4, w: W_SNAP * 0.5, hard: true, auto: true });
    else if (Math.abs(ab - 3 * Math.PI / 4) < 4 * DEG) targets.push({ i, target: Math.sign(phi) * 3 * Math.PI / 4, w: W_SNAP * 0.5, hard: true, auto: true });
    else targets.push({ i, target: phi, w: W_KEEP, hard: false });
  }
  return targets;
}

function detectParallel(shape, X) {
  const m = segmentCount(shape);
  const n = shape.vertices.length;
  const dir = (i) => {
    const j = (i + 1) % n;
    const d = { x: X[2 * j] - X[2 * i], y: X[2 * j + 1] - X[2 * i + 1] };
    return Math.atan2(d.y, d.x);
  };
  const pairs = [];
  for (let i = 0; i < m; i++) {
    if (shape.segments[i].type === 'arc') continue;
    for (let j = i + 2; j < m; j++) {
      if (shape.closed && i === 0 && j === m - 1) continue; // adjacentes pelo fechamento
      if (shape.segments[j].type === 'arc') continue;
      let d = Math.abs(wrapAngle(dir(i) - dir(j)));
      d = Math.min(d, Math.PI - d);
      if (d < 5 * DEG) pairs.push([i, j]);
    }
  }
  return pairs;
}

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/**
 * Resolve uma forma. Não muta a entrada: devolve { vertices, segments, report, scale }.
 * opts.force: roda mesmo sem medidas (esquadrejar esboço).
 */
export function solveShape(shape, opts = {}) {
  const n = shape.vertices.length;
  const m = segmentCount(shape);
  const segs = shape.segments.map((s) => ({ ...s }));
  const measured = [];
  for (let i = 0; i < m; i++) if (chordTarget(segs[i]) != null) measured.push(i);

  const empty = { segErr: {}, badSegments: [], badVertices: [], snapped: [] };
  if (n < 2 || (!measured.length && !opts.force)) {
    return { vertices: shape.vertices.map((v) => ({ ...v })), segments: segs, report: empty, scale: 1 };
  }

  // 1) Reescala global: média geométrica das razões medida/atual.
  let X = [];
  shape.vertices.forEach((v) => X.push(v.x, v.y));
  const cx = shape.vertices.reduce((s, v) => s + v.x, 0) / n;
  const cy = shape.vertices.reduce((s, v) => s + v.y, 0) / n;
  let scale = 1;
  if (measured.length) {
    let logSum = 0, k = 0;
    for (const i of measured) {
      const j = (i + 1) % n;
      const c = Math.hypot(X[2 * j] - X[2 * i], X[2 * j + 1] - X[2 * i + 1]);
      if (c > 1e-9) { logSum += Math.log(chordTarget(segs[i]) / c); k++; }
    }
    if (k) scale = Math.exp(logSum / k);
    for (let i = 0; i < n; i++) {
      X[2 * i] = cx + (X[2 * i] - cx) * scale;
      X[2 * i + 1] = cy + (X[2 * i + 1] - cy) * scale;
    }
  }
  const X0 = X.slice();
  const scaledShape = { ...shape, vertices: shape.vertices.map((v, i) => ({ ...v, x: X[2 * i], y: X[2 * i + 1] })) };

  let Lref = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n;
    Lref += Math.hypot(X[2 * j] - X[2 * i], X[2 * j + 1] - X[2 * i + 1]);
  }
  Lref = Lref / (m || 1) || 1;

  const angleTargets = detectAngleTargets(scaledShape, X);
  const parallels = detectParallel(scaledShape, X);

  const residuals = (Y) => {
    const r = [];
    const px = (i) => Y[2 * i], py = (i) => Y[2 * i + 1];
    for (const i of measured) {
      const j = (i + 1) % n;
      r.push(W_LEN * (Math.hypot(px(j) - px(i), py(j) - py(i)) - chordTarget(segs[i])));
    }
    for (const t of angleTargets) {
      const a = (t.i - 1 + n) % n, b = t.i, c = (t.i + 1) % n;
      const ux = px(b) - px(a), uy = py(b) - py(a), wx = px(c) - px(b), wy = py(c) - py(b);
      const phi = Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy);
      r.push(t.w * wrapAngle(phi - t.target) * Lref);
    }
    for (const [i, j] of parallels) {
      const i2 = (i + 1) % n, j2 = (j + 1) % n;
      const ux = px(i2) - px(i), uy = py(i2) - py(i), vx = px(j2) - px(j), vy = py(j2) - py(j);
      const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
      r.push(W_PAR * ((ux * vy - uy * vx) / (lu * lv)) * Lref);
    }
    for (let k = 0; k < Y.length; k++) r.push(W_GAUGE * (Y[k] - X0[k]));
    return r;
  };
  const cost = (r) => r.reduce((s, v) => s + v * v, 0);

  // 2) Levenberg–Marquardt.
  let r = residuals(X);
  let c0 = cost(r);
  let lambda = 1e-3;
  const N = X.length;
  const h = 1e-6 * Lref;
  for (let iter = 0; iter < 80; iter++) {
    const J = [];
    for (let k = 0; k < N; k++) {
      const Y = X.slice();
      Y[k] += h;
      const r2 = residuals(Y);
      J.push(r2.map((v, idx) => (v - r[idx]) / h)); // coluna k
    }
    const A = Array.from({ length: N }, () => new Array(N).fill(0));
    const g = new Array(N).fill(0);
    for (let a = 0; a < N; a++) {
      const Ja = J[a];
      for (let b = a; b < N; b++) {
        const Jb = J[b];
        let s = 0;
        for (let q = 0; q < r.length; q++) s += Ja[q] * Jb[q];
        A[a][b] = A[b][a] = s;
      }
      let s = 0;
      for (let q = 0; q < r.length; q++) s += Ja[q] * r[q];
      g[a] = -s;
    }
    let improved = false;
    for (let tries = 0; tries < 10; tries++) {
      const Ad = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const d = solveLinear(Ad, g);
      if (!d) { lambda *= 10; continue; }
      const Xn = X.map((v, k) => v + d[k]);
      const rn = residuals(Xn);
      const cn = cost(rn);
      if (cn < c0) {
        const step = Math.sqrt(d.reduce((s, v) => s + v * v, 0));
        X = Xn; r = rn;
        const rel = (c0 - cn) / (c0 || 1);
        c0 = cn;
        lambda = Math.max(lambda / 3, 1e-9);
        improved = true;
        if (step < 1e-9 * Lref || rel < 1e-12) iter = 1e9;
        break;
      }
      lambda *= 4;
    }
    if (!improved) break;
  }

  const vertices = shape.vertices.map((v, i) => ({ ...v, x: X[2 * i], y: X[2 * i + 1] }));

  // 3) Arcos com flecha medida: bulge = 2·flecha/corda.
  for (let i = 0; i < m; i++) {
    const s = segs[i];
    if (s.type === 'arc' && s.sagitta != null) {
      const c = dist(vertices[i], vertices[(i + 1) % n]);
      if (c > 1e-9) s.bulge = Math.sign(s.bulge || 1) * Math.min(4, (2 * Math.abs(s.sagitta)) / c);
    }
  }

  // 4) Relatório de inconsistências.
  const report = { segErr: {}, badSegments: [], badVertices: [], snapped: [] };
  for (const i of measured) {
    const c = dist(vertices[i], vertices[(i + 1) % n]);
    const e = c - chordTarget(segs[i]);
    report.segErr[i] = e;
    if (Math.abs(e) > lengthTolerance(chordTarget(segs[i]))) report.badSegments.push(i);
  }
  for (const t of angleTargets) {
    if (!t.hard) continue;
    const a = vertices[(t.i - 1 + n) % n], b = vertices[t.i], c = vertices[(t.i + 1) % n];
    const u = sub(b, a), w = sub(c, b);
    const phi = Math.atan2(cross(u, w), dot(u, w));
    const err = Math.abs(wrapAngle(phi - t.target)) / DEG;
    if (err > TOL_ANGLE_DEG) report.badVertices.push(t.i);
    else if (Math.abs(Math.abs(t.target) - Math.PI / 2) < 1e-9) report.snapped.push(t.i);
  }
  return { vertices, segments: segs, report, scale };
}

// Verificação rápida (sem resolver) de ângulos retos, para desenhar o símbolo ⊾.
export function rightAngleVertices(shape) {
  const n = shape.vertices.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!shape.closed && (i === 0 || i === n - 1)) continue;
    if (n < 3) continue;
    const a = shape.vertices[(i - 1 + n) % n], b = shape.vertices[i], c = shape.vertices[(i + 1) % n];
    const u = sub(b, a), w = sub(c, b);
    const phi = Math.atan2(cross(u, w), dot(u, w));
    if (Math.abs(Math.abs(phi) - Math.PI / 2) < TOL_ANGLE_DEG * DEG) out.push(i);
  }
  return out;
}

export { arcInfo };
