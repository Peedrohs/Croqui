// Reconhecimento de traço à mão livre → vértices + segmentos (retas e arcos).
// 1) reamostragem uniforme  2) cantos por "ShortStraw"  3) ajuste recursivo reta/arco
// 4) fusão de retas colineares e arcos contínuos  5) fechamento automático.
import { dist, sub, cross, len, lerp, wrapAngle } from './geometry.js';

function resample(pts, S) {
  const out = [pts[0]];
  let acc = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let cur = pts[i];
    let d = dist(prev, cur);
    while (acc + d >= S) {
      const t = (S - acc) / d;
      const q = lerp(prev, cur, t);
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  if (dist(out[out.length - 1], pts[pts.length - 1]) > S * 0.3) out.push(pts[pts.length - 1]);
  return out;
}

function lineDeviation(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  const d = sub(b, a);
  const l = len(d) || 1;
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const e = Math.abs(cross(d, sub(pts[i], a))) / l;
    if (e > max) { max = e; idx = i; }
  }
  return { max, idx, chord: l };
}

function circleFrom3(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

// Tenta ajustar um arco: devolve bulge ou null.
function fitArc(pts, tol) {
  if (pts.length < 5) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const c = dist(a, b);
  if (c < 1e-9) return null;
  const d = sub(b, a);
  const nrm = { x: -d.y / c, y: d.x / c };
  // Ponto do traço mais próximo da mediatriz da corda.
  const mid = lerp(a, b, 0.5);
  let best = null, bd = Infinity;
  for (const p of pts) {
    const along = Math.abs((p.x - mid.x) * d.x + (p.y - mid.y) * d.y) / c;
    if (along < bd) { bd = along; best = p; }
  }
  const s = (best.x - mid.x) * nrm.x + (best.y - mid.y) * nrm.y; // flecha com sinal
  const bulge = (2 * s) / c;
  if (Math.abs(bulge) < 0.05 || Math.abs(bulge) > 2.5) return null;
  const circ = circleFrom3(a, best, b);
  if (!circ) return null;
  let max = 0;
  for (const p of pts) max = Math.max(max, Math.abs(Math.hypot(p.x - circ.x, p.y - circ.y) - circ.r));
  // Todos os pontos devem ficar do mesmo lado da corda que a flecha.
  let wrong = 0;
  for (const p of pts) if (((p.x - a.x) * nrm.x + (p.y - a.y) * nrm.y) * Math.sign(s) < -tol) wrong++;
  if (wrong > pts.length * 0.1) return null;
  return max <= Math.max(tol * 1.4, 0.06 * c) ? bulge : null;
}

function fitPiece(pts, tol, out, depth = 0) {
  const { max, idx, chord } = lineDeviation(pts);
  if (max <= Math.max(tol, 0.03 * chord) || pts.length < 4) {
    out.push({ type: 'line', bulge: 0, pts });
    return;
  }
  const bulge = fitArc(pts, tol);
  if (bulge != null) {
    out.push({ type: 'arc', bulge, pts });
    return;
  }
  if (depth > 12 || idx < 2 || idx > pts.length - 3) {
    out.push({ type: 'line', bulge: 0, pts });
    return;
  }
  fitPiece(pts.slice(0, idx + 1), tol, out, depth + 1);
  fitPiece(pts.slice(idx), tol, out, depth + 1);
}

function dirOf(p) {
  const a = p.pts[0], b = p.pts[p.pts.length - 1];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function tryMerge(p, q, tol) {
  const pts = p.pts.concat(q.pts.slice(1));
  if (p.type === 'line' && q.type === 'line') {
    if (Math.abs(wrapAngle(dirOf(p) - dirOf(q))) > 14 * Math.PI / 180) return null;
    const { max, chord } = lineDeviation(pts);
    return max <= Math.max(tol, 0.03 * chord) ? { type: 'line', bulge: 0, pts } : null;
  }
  if (p.type === 'arc' && q.type === 'arc' && Math.sign(p.bulge) === Math.sign(q.bulge)) {
    const b = fitArc(pts, tol);
    return b != null ? { type: 'arc', bulge: b, pts } : null;
  }
  return null;
}

function mergePass(pieces, tol, closed) {
  let changed = true;
  while (changed && pieces.length > 1) {
    changed = false;
    for (let i = 0; i < pieces.length - 1; i++) {
      const m = tryMerge(pieces[i], pieces[i + 1], tol);
      if (m) { pieces.splice(i, 2, m); changed = true; break; }
    }
    if (!changed && closed && pieces.length > 2) {
      const m = tryMerge(pieces[pieces.length - 1], pieces[0], tol);
      if (m) { pieces.pop(); pieces[0] = m; changed = true; }
    }
  }
  return pieces;
}

// Pedaços minúsculos (sobra do fechamento, tremida) são incorporados ao vizinho.
function absorbTiny(pieces, minLen, tol, closed) {
  const chord = (p) => dist(p.pts[0], p.pts[p.pts.length - 1]);
  let guard = 0;
  while (pieces.length > (closed ? 2 : 1) && guard++ < 50) {
    const i = pieces.findIndex((p) => chord(p) < minLen);
    if (i < 0) break;
    const tiny = pieces[i];
    const hasPrev = i > 0 || closed;
    const j = hasPrev ? (i - 1 + pieces.length) % pieces.length : i + 1;
    const nb = pieces[j];
    const pts = hasPrev ? nb.pts.concat(tiny.pts.slice(1)) : tiny.pts.concat(nb.pts.slice(1));
    const merged = { type: nb.type, bulge: nb.bulge, pts };
    if (nb.type === 'arc') merged.bulge = fitArc(pts, tol * 2) ?? nb.bulge;
    pieces[j] = merged;
    pieces.splice(i, 1);
  }
  return pieces;
}

/**
 * @param raw  pontos do traço em coordenadas do mundo
 * @param px   tamanho de 1 pixel de tela em unidades do mundo
 */
export function recognizeStroke(raw, px) {
  if (raw.length < 4) return null;
  let diag = 0;
  {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of raw) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    diag = Math.hypot(x1 - x0, y1 - y0);
  }
  if (diag < 20 * px) return null;
  const S = Math.max(diag / 90, 3 * px);
  let pts = resample(raw, S);
  const closed = pts.length > 8 && dist(pts[0], pts[pts.length - 1]) < Math.max(0.15 * diag, 30 * px);
  if (closed) pts[pts.length - 1] = { ...pts[0] };
  const N = pts.length;
  const W = 3;
  const at = (i) => (closed ? pts[((i % (N - 1)) + (N - 1)) % (N - 1)] : pts[Math.max(0, Math.min(N - 1, i))]);

  // ShortStraw: "canudos" curtos = cantos.
  const straws = [];
  for (let i = 0; i < N; i++) straws.push(dist(at(i - W), at(i + W)));
  const sorted = straws.slice(closed ? 0 : W, closed ? N - 1 : N - W).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const thr = median * 0.9;
  let corners = [];
  const lo = closed ? 0 : W, hi = closed ? N - 1 : N - W;
  for (let i = lo; i < hi; i++) {
    if (straws[i] >= thr) continue;
    let j = i, min = straws[i], mi = i;
    while (j < hi && straws[j] < thr) { if (straws[j] < min) { min = straws[j]; mi = j; } j++; }
    corners.push(mi);
    i = j;
  }
  // Canto também por mudança de direção forte (cantos arredondados de piscina escapam do straw).
  if (!closed) { corners.unshift(0); corners.push(N - 1); }
  corners = [...new Set(corners)].sort((a, b) => a - b);

  const tol = Math.max(4 * px, diag * 0.012);
  let pieces = [];
  if (closed) {
    if (corners.length < 2) {
      const base = corners[0] ?? 0;
      corners = [base, (base + Math.floor((N - 1) / 2)) % (N - 1)].sort((a, b) => a - b);
    }
    const M = N - 1;
    for (let k = 0; k < corners.length; k++) {
      const s = corners[k], e = corners[(k + 1) % corners.length] + (k === corners.length - 1 ? M : 0);
      const seg = [];
      for (let i = s; i <= e; i++) seg.push(pts[i % M]);
      fitPiece(seg, tol, pieces);
    }
  } else {
    for (let k = 0; k < corners.length - 1; k++) fitPiece(pts.slice(corners[k], corners[k + 1] + 1), tol, pieces);
  }
  pieces = mergePass(pieces, tol, closed);
  pieces = absorbTiny(pieces, diag * 0.07, tol, closed);
  if (closed && pieces.length < 2) return null;

  const vertices = pieces.map((p) => ({ x: p.pts[0].x, y: p.pts[0].y }));
  if (!closed) vertices.push({ ...pieces[pieces.length - 1].pts[pieces[pieces.length - 1].pts.length - 1] });
  const segments = pieces.map((p) => ({ type: p.type, bulge: p.type === 'arc' ? p.bulge : 0, length: null }));
  return { vertices, segments, closed };
}
