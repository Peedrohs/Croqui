// Estrutura de dados do croqui + operações. Os dois modos de desenho geram a MESMA estrutura.
//
// content = { version, unit:'ft'|'m', calibrated:bool, shapes:[Shape], texts:[Text] }
// Shape   = { id, name, closed, fill|null,
//             vertices:[{x,y, angleMode:'auto'|'right'|'free'|'fixed', angle?}],
//             segments:[{type:'line'|'arc', bulge, length:null|m, sagitta?:null|m}] }
// Text    = { id, x, y, w, size, text }   (mundo: metros)
import { uid } from './util.js';
import { solveShape } from './solver.js';
import { polygonize, pointInPolygon, shapeArea, shapePerimeter, segmentCount, lerp, segInfo, add, mul } from './geometry.js';

export const newContent = (unit = 'ft') => ({ version: 1, unit, calibrated: false, shapes: [], texts: [] });

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
  let area = 0, perimeter = 0;
  for (const s of closed) if (!per[s.id].parent) area += per[s.id].area;
  for (const s of content.shapes) perimeter += per[s.id].perimeter;
  return { per, area, perimeter };
}

export function insertVertex(shape, i) {
  const info = segInfo(shape, i);
  const seg = shape.segments[i];
  const p = info.arc ? info.arc.M : lerp(info.p0, info.p1, 0.5);
  shape.vertices.splice(i + 1, 0, { x: p.x, y: p.y, angleMode: 'free' });
  const b = seg.type === 'arc' ? Math.tan(Math.atan(seg.bulge) / 2) : 0;
  const a = { ...seg, bulge: b, length: null, sagitta: null };
  shape.segments.splice(i, 1, a, { ...a });
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
