// Montagem do SVG. Texturas em coordenadas do mundo (um <g> com transform);
// linhas, cotas e textos em coordenadas de tela, para ficarem nítidos em qualquer zoom.
import { f1, esc, vertexLabel } from './util.js';
import { polygonize, segmentCount, segInfo, orientation, sub, add, mul, norm, labelPoint, shapeArea } from './geometry.js';
import { formatLength, formatArea, M_PER_FT } from './units.js';
import { renderFill } from './textures.js';
import { rightAngleVertices } from './solver.js';
import { stats } from './model.js';

export const COLORS = {
  ink: '#1c2533', accent: '#0a7cff', measured: '#111827', approx: '#7b8595', bad: '#e0392b', handle: '#ffffff',
};

const S = (p, v) => ({ x: p.x * v.k + v.x, y: p.y * v.k + v.y });

let measureCtx = null;
export function textWidth(text, px, weight = 600) {
  if (typeof document === 'undefined') return text.length * px * 0.58;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = `${weight} ${px}px -apple-system, system-ui, Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(text).width;
}

export function wrapText(text, px, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (line && textWidth(t, px, 400) > maxW) { lines.push(line); line = w; } else line = t;
    }
    lines.push(line);
  }
  return lines;
}

// ---------- Texturas (mundo) ----------
export function buildFills(content) {
  const closed = content.shapes.filter((s) => s.closed && s.vertices.length >= 3);
  closed.sort((a, b) => shapeArea(b) - shapeArea(a));
  let out = '';
  for (const s of closed) {
    const poly = polygonize(s);
    if (s.fill) out += renderFill(poly, s.fill, s.id);
    else out += `<path d="M${poly.map((p) => `${p.x} ${p.y}`).join('L')}Z" fill="#ffffff" fill-opacity=".85"/>`;
  }
  return out;
}

// ---------- Grade (tela) ----------
export function buildGrid(view, w, h, unit) {
  let step = unit === 'ft' ? M_PER_FT : 1;
  const major = unit === 'ft' ? 10 : 5;
  while (step * view.k < 14) step *= major;
  const x0 = -view.x / view.k, y0 = -view.y / view.k;
  const x1 = (w - view.x) / view.k, y1 = (h - view.y) / view.k;
  let minor = '', maj = '';
  const i0 = Math.floor(x0 / step), i1 = Math.ceil(x1 / step);
  const j0 = Math.floor(y0 / step), j1 = Math.ceil(y1 / step);
  if (i1 - i0 > 400 || j1 - j0 > 400) return '';
  for (let i = i0; i <= i1; i++) {
    const X = f1(i * step * view.k + view.x);
    (i % major === 0 ? (maj += `M${X} 0V${h}`) : (minor += `M${X} 0V${h}`));
  }
  for (let j = j0; j <= j1; j++) {
    const Y = f1(j * step * view.k + view.y);
    (j % major === 0 ? (maj += `M0 ${Y}H${w}`) : (minor += `M0 ${Y}H${w}`));
  }
  return `<path d="${minor}" stroke="#e9edf2" stroke-width="1"/><path d="${maj}" stroke="#d6dde6" stroke-width="1"/>`;
}

// ---------- Caminho de contorno (tela) ----------
function segPath(shape, i, v, move = true) {
  const { p0, p1, arc } = segInfo(shape, i);
  const a = S(p0, v), b = S(p1, v);
  let d = move ? `M${f1(a.x)} ${f1(a.y)}` : '';
  if (arc) {
    const r = arc.r * v.k;
    const large = Math.abs(arc.theta) > Math.PI ? 1 : 0;
    const sweep = shape.segments[i].bulge > 0 ? 0 : 1;
    d += `A${f1(r)} ${f1(r)} 0 ${large} ${sweep} ${f1(b.x)} ${f1(b.y)}`;
  } else d += `L${f1(b.x)} ${f1(b.y)}`;
  return d;
}

export function shapePath(shape, v) {
  const m = segmentCount(shape);
  if (!m) return '';
  let d = '';
  for (let i = 0; i < m; i++) d += segPath(shape, i, v, i === 0);
  return d + (shape.closed ? 'Z' : '');
}

// ---------- Cotas ----------
function label(x, y, angDeg, text, { color, weight = 600, px = 14, bg = '#fff', border = null, hit = '' } = {}) {
  const w = textWidth(text, px, weight) + 10, h = px + 8;
  return `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(angDeg)})" ${hit}>` +
    `<rect x="${f1(-w / 2)}" y="${f1(-h / 2)}" width="${f1(w)}" height="${f1(h)}" rx="${f1(h / 2)}" fill="${bg}" ${border ? `stroke="${border}" stroke-width="1.5"` : ''}/>` +
    `<text x="0" y="${f1(px * 0.36)}" text-anchor="middle" font-size="${px}" font-weight="${weight}" fill="${color}">${esc(text)}</text></g>`;
}

const upright = (d) => { let a = (Math.atan2(d.y, d.x) * 180) / Math.PI; if (a > 90) a -= 180; if (a <= -90) a += 180; return a; };

function dims(content, shape, v, report, opts) {
  const m = segmentCount(shape);
  const orient = orientation(shape);
  const unit = content.unit;
  let out = '';
  const px = opts.export ? 22 : 14;
  for (let i = 0; i < m; i++) {
    const seg = shape.segments[i];
    const info = segInfo(shape, i);
    const a = S(info.p0, v), b = S(info.p1, v);
    const dd = sub(b, a);
    const L = Math.hypot(dd.x, dd.y);
    if (L < 6) continue;
    const d = norm(dd);
    const nL = { x: -d.y, y: d.x };
    const out1 = shape.closed ? (orient > 0 ? mul(nL, -1) : nL) : mul(nL, -1);
    const measured = seg.length != null;
    const bad = report?.badSegments?.includes(i);
    const color = bad ? COLORS.bad : measured ? COLORS.measured : COLORS.approx;
    let text = measured ? formatLength(seg.length, unit) : content.calibrated ? '~' + formatLength(info.chord, unit) : '?';
    if (bad) text = '⚠ ' + text;
    const hit = opts.export ? '' : `data-hit="dim" data-s="${shape.id}" data-i="${i}"`;
    const ang = upright(d);
    if (!info.arc) {
      const OFF = opts.export ? 42 : 26;
      const A = add(a, mul(out1, OFF)), B = add(b, mul(out1, OFF));
      const t = opts.export ? 7 : 5;
      const tick = (P) => `M${f1(P.x - (d.x + out1.x) * t)} ${f1(P.y - (d.y + out1.y) * t)}L${f1(P.x + (d.x + out1.x) * t)} ${f1(P.y + (d.y + out1.y) * t)}`;
      const ext = `M${f1(a.x + out1.x * 6)} ${f1(a.y + out1.y * 6)}L${f1(A.x + out1.x * 6)} ${f1(A.y + out1.y * 6)}` +
        `M${f1(b.x + out1.x * 6)} ${f1(b.y + out1.y * 6)}L${f1(B.x + out1.x * 6)} ${f1(B.y + out1.y * 6)}`;
      out += `<path d="${ext}M${f1(A.x)} ${f1(A.y)}L${f1(B.x)} ${f1(B.y)}${tick(A)}${tick(B)}" stroke="${color}" stroke-width="1" fill="none" opacity="${measured ? 0.9 : 0.6}"/>`;
      const mid = add(a, mul(dd, 0.5));
      const P = add(mid, mul(out1, OFF));
      out += label(P.x, P.y, ang, text, { color, weight: measured ? 700 : 500, px, border: bad ? COLORS.bad : null, hit });
    } else {
      // Arco: cota da corda (tracejada) + flecha junto ao arco.
      out += `<path d="M${f1(a.x)} ${f1(a.y)}L${f1(b.x)} ${f1(b.y)}" stroke="${color}" stroke-width="1" stroke-dasharray="4 4" opacity=".6"/>`;
      const mid = add(a, mul(dd, 0.5));
      out += label(mid.x, mid.y, ang, 'C ' + text, { color, weight: measured ? 700 : 500, px, border: bad ? COLORS.bad : null, hit });
      const M = S(info.arc.M, v);
      const bdir = mul(info.arc.nrm, Math.sign(seg.bulge));
      const P = add(M, mul(bdir, 18));
      const ftxt = seg.sagitta != null ? 'f ' + formatLength(Math.abs(seg.sagitta), unit) : content.calibrated ? 'f ~' + formatLength(Math.abs(info.arc.sagitta), unit) : '';
      if (ftxt) out += label(P.x, P.y, ang, ftxt, { color: seg.sagitta != null ? COLORS.measured : COLORS.approx, weight: 500, px: px - 2, hit });
    }
  }
  return out;
}

function rightMarks(shape, v, big) {
  const n = shape.vertices.length;
  let d = '';
  for (const i of rightAngleVertices(shape)) {
    const a = S(shape.vertices[(i - 1 + n) % n], v), b = S(shape.vertices[i], v), c = S(shape.vertices[(i + 1) % n], v);
    const u = norm(sub(a, b)), w = norm(sub(c, b));
    const s = big ? 16 : 9;
    const p1 = add(b, mul(u, s)), p2 = add(add(b, mul(u, s)), mul(w, s)), p3 = add(b, mul(w, s));
    d += `M${f1(p1.x)} ${f1(p1.y)}L${f1(p2.x)} ${f1(p2.y)}L${f1(p3.x)} ${f1(p3.y)}`;
  }
  return d ? `<path d="${d}" stroke="${COLORS.ink}" stroke-width="1" fill="none" opacity=".55"/>` : '';
}

function areaLabel(content, shape, v, st, opts) {
  if (!shape.closed || shape.vertices.length < 3) return '';
  const c = S(labelPoint(polygonize(shape)), v);
  if (!content.calibrated && !opts.export) return shape.name ? label(c.x, c.y, 0, shape.name, { color: COLORS.ink, px: 13 }) : '';
  const s = st.per[shape.id];
  const areaTxt = formatArea(s.net, content.unit) + (s.net !== s.area ? ' (líq.)' : '');
  const px = opts.export ? 22 : 13;
  let o = '';
  if (shape.name) o += label(c.x, c.y - px, 0, shape.name, { color: COLORS.ink, px, weight: 700 });
  o += label(c.x, c.y + (shape.name ? px * 0.9 : 0), 0, areaTxt, { color: '#334155', px: px - 1, weight: 500, bg: '#ffffffd9' });
  return o;
}

function texts(content, v, ui, opts) {
  let o = '';
  for (const t of content.texts) {
    const px = t.size * v.k;
    const w = t.w * v.k;
    const lines = wrapText(t.text || ' ', px, w - px * 0.6);
    const h = lines.length * px * 1.25 + px * 0.6;
    const x = t.x * v.k + v.x, y = t.y * v.k + v.y;
    const sel = ui.sel?.kind === 'text' && ui.sel.id === t.id && !opts.export;
    o += `<g ${opts.export ? '' : `data-hit="text" data-t="${t.id}"`}>`;
    o += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" rx="6" fill="#fffef5" fill-opacity=".92" stroke="${sel ? COLORS.accent : '#d9d3b8'}" stroke-width="${sel ? 2 : 1}" ${sel ? '' : 'stroke-dasharray="3 3"'}/>`;
    lines.forEach((ln, i) => {
      o += `<text x="${f1(x + px * 0.3)}" y="${f1(y + px * 0.3 + px * (i + 0.95) * 1.25 - px * 0.25)}" font-size="${f1(px)}" fill="${COLORS.ink}">${esc(ln)}</text>`;
    });
    o += '</g>';
    if (sel) o += `<g data-hit="textresize" data-t="${t.id}"><circle cx="${f1(x + w)}" cy="${f1(y + h)}" r="16" fill="transparent"/><rect x="${f1(x + w - 7)}" y="${f1(y + h - 7)}" width="14" height="14" rx="3" fill="${COLORS.accent}" stroke="#fff" stroke-width="2"/></g>`;
  }
  return o;
}

/**
 * ui = { sel, tool, reports, drawing:{shapeId, preview, snap, closeHint}, freehand:[pts] }
 * opts = { export:bool }
 */
export function buildOverlay(content, v, ui = {}, opts = {}) {
  const st = stats(content);
  let o = '';
  const selShape = ui.sel && ui.sel.shapeId;
  for (const s of content.shapes) {
    const d = shapePath(s, v);
    if (!d) continue;
    const isSel = s.id === selShape && !opts.export;
    const report = ui.reports?.[s.id];
    o += `<path d="${d}" fill="none" stroke="${isSel ? COLORS.accent : COLORS.ink}" stroke-width="${opts.export ? 3 : 2.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (report?.badSegments?.length && !opts.export) {
      for (const i of report.badSegments) o += `<path d="${segPath(s, i, v)}" fill="none" stroke="${COLORS.bad}" stroke-width="4" stroke-linecap="round"/>`;
    }
    if (!opts.export) {
      for (let i = 0, m = segmentCount(s); i < m; i++) {
        const segSel = ui.sel?.kind === 'seg' && ui.sel.shapeId === s.id && ui.sel.i === i;
        if (segSel) o += `<path d="${segPath(s, i, v)}" fill="none" stroke="${COLORS.accent}" stroke-width="6" stroke-linecap="round" opacity=".45"/>`;
        o += `<path d="${segPath(s, i, v)}" fill="none" stroke="transparent" stroke-width="28" data-hit="seg" data-s="${s.id}" data-i="${i}"/>`;
      }
    }
    o += rightMarks(s, v, opts.export);
  }
  for (const s of content.shapes) o += dims(content, s, v, ui.reports?.[s.id], opts);
  for (const s of content.shapes) o += areaLabel(content, s, v, st, opts);
  o += texts(content, v, ui, opts);

  if (!opts.export) {
    // Alças de vértice e de arco.
    const drawingId = ui.drawing?.shapeId;
    for (const s of content.shapes) {
      const active = s.id === selShape || s.id === drawingId;
      if (!active && ui.tool !== 'select') continue;
      s.vertices.forEach((p, i) => {
        const q = S(p, v);
        const vSel = ui.sel?.kind === 'vertex' && ui.sel.shapeId === s.id && ui.sel.i === i;
        const bad = ui.reports?.[s.id]?.badVertices?.includes(i);
        const r = active ? 7 : 4.5;
        o += `<g data-hit="vertex" data-s="${s.id}" data-i="${i}"><circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="20" fill="transparent"/>` +
          `<circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="${vSel ? 9 : r}" fill="${vSel ? COLORS.accent : '#fff'}" stroke="${bad ? COLORS.bad : active ? COLORS.accent : COLORS.ink}" stroke-width="2"/></g>`;
        if (s.id === selShape) o += `<text x="${f1(q.x + 10)}" y="${f1(q.y - 10)}" font-size="12" font-weight="700" fill="${COLORS.accent}" style="paint-order:stroke" stroke="#fff" stroke-width="3">${vertexLabel(i)}</text>`;
      });
      if (s.id === selShape) {
        for (let i = 0, m = segmentCount(s); i < m; i++) {
          const info = segInfo(s, i);
          if (!info.arc) continue;
          const q = S(info.arc.M, v);
          o += `<g data-hit="bulge" data-s="${s.id}" data-i="${i}"><circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="20" fill="transparent"/>` +
            `<rect x="${f1(q.x - 6)}" y="${f1(q.y - 6)}" width="12" height="12" transform="rotate(45 ${f1(q.x)} ${f1(q.y)})" fill="#fff" stroke="${COLORS.accent}" stroke-width="2"/></g>`;
        }
      }
    }
    // Pré-visualização do modo ponto a ponto.
    const dr = ui.drawing;
    if (dr?.preview) {
      const s = content.shapes.find((x) => x.id === dr.shapeId);
      const q = S(dr.preview, v);
      if (s && s.vertices.length) {
        const last = S(s.vertices[s.vertices.length - 1], v);
        if (dr.arc) {
          const dd = sub(q, last), L = Math.hypot(dd.x, dd.y);
          const r = (L * (1 + 0.35 * 0.35)) / (4 * 0.35);
          o += `<path d="M${f1(last.x)} ${f1(last.y)}A${f1(r)} ${f1(r)} 0 0 0 ${f1(q.x)} ${f1(q.y)}" stroke="${COLORS.accent}" stroke-width="2" stroke-dasharray="6 5" fill="none"/>`;
        } else o += `<path d="M${f1(last.x)} ${f1(last.y)}L${f1(q.x)} ${f1(q.y)}" stroke="${COLORS.accent}" stroke-width="2" stroke-dasharray="6 5"/>`;
        if (content.calibrated) {
          const L = Math.hypot(dr.preview.x - s.vertices[s.vertices.length - 1].x, dr.preview.y - s.vertices[s.vertices.length - 1].y);
          o += label((last.x + q.x) / 2, (last.y + q.y) / 2 - 18, 0, '~' + formatLength(L, content.unit), { color: COLORS.accent, px: 13 });
        }
        if (dr.closeHint) {
          const f = S(s.vertices[0], v);
          o += `<circle cx="${f1(f.x)}" cy="${f1(f.y)}" r="16" fill="${COLORS.accent}" fill-opacity=".15" stroke="${COLORS.accent}" stroke-width="2"/>`;
        }
      }
      if (dr.guide) {
        const g0 = S(dr.guide[0], v);
        o += `<path d="M${f1(g0.x)} ${f1(g0.y)}L${f1(q.x)} ${f1(q.y)}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="2 4"/>`;
      }
      o += `<circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="6" fill="${dr.snap ? '#f59e0b' : COLORS.accent}" stroke="#fff" stroke-width="2"/>`;
    }
    if (ui.freehand?.length > 1) {
      const pts = ui.freehand.map((p) => S(p, v));
      o += `<path d="M${pts.map((p) => `${f1(p.x)} ${f1(p.y)}`).join('L')}" stroke="${COLORS.accent}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`;
    }
  }
  return o;
}

// ---------- Exportação: SVG completo e autossuficiente ----------
export function buildExportSVG(content, { title = '', subtitle = '', width = 2200 } = {}) {
  const st = stats(content);
  const pts = [];
  for (const s of content.shapes) pts.push(...polygonize(s));
  for (const t of content.texts) pts.push({ x: t.x, y: t.y }, { x: t.x + t.w, y: t.y + t.size * 3 });
  if (!pts.length) pts.push({ x: 0, y: 0 }, { x: 1, y: 1 });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const bw = Math.max(x1 - x0, 1e-3), bh = Math.max(y1 - y0, 1e-3);
  const pad = 110, header = 120;
  const k = Math.min((width - 2 * pad) / bw, 1500 / bh);
  const drawH = bh * k + 2 * pad;
  const closed = content.shapes.filter((s) => s.closed && s.vertices.length >= 3);
  const rowH = 38;
  const legendH = closed.length ? 70 + (closed.length + 1) * rowH : 40;
  const height = Math.round(header + drawH + legendH);
  const v = { k, x: pad - x0 * k + (width - 2 * pad - bw * k) / 2, y: header + pad - y0 * k };

  let legend = '';
  let y = header + drawH + 20;
  if (closed.length) {
    const cols = [60, 700, 1260, 1720];
    legend += `<text x="${cols[0]}" y="${y + 24}" font-size="18" font-weight="700" fill="#64748b">ÁREA</text><text x="${cols[1]}" y="${y + 24}" font-size="18" font-weight="700" fill="#64748b">ACABAMENTO</text><text x="${cols[2]}" y="${y + 24}" font-size="18" font-weight="700" fill="#64748b">SUPERFÍCIE</text><text x="${cols[3]}" y="${y + 24}" font-size="18" font-weight="700" fill="#64748b">PERÍMETRO</text>`;
    y += 40;
    closed.forEach((s, idx) => {
      const p = st.per[s.id];
      const name = s.name || `Área ${idx + 1}`;
      legend += `<line x1="50" x2="${width - 50}" y1="${y}" y2="${y}" stroke="#e2e8f0"/>`;
      legend += `<text x="${cols[0]}" y="${y + 26}" font-size="20" font-weight="600" fill="#0f172a">${esc(name)}</text>` +
        `<text x="${cols[1]}" y="${y + 26}" font-size="20" fill="#334155">${esc(textureNameSafe(s.fill))}</text>` +
        `<text x="${cols[2]}" y="${y + 26}" font-size="20" fill="#0f172a">${esc(formatArea(p.net, content.unit))}${p.net !== p.area ? ' líq.' : ''}</text>` +
        `<text x="${cols[3]}" y="${y + 26}" font-size="20" fill="#0f172a">${esc(formatLength(p.perimeter, content.unit))}</text>`;
      y += rowH;
    });
    legend += `<line x1="50" x2="${width - 50}" y1="${y}" y2="${y}" stroke="#94a3b8"/>`;
    legend += `<text x="${cols[0]}" y="${y + 28}" font-size="21" font-weight="800" fill="#0f172a">Total</text><text x="${cols[2]}" y="${y + 28}" font-size="21" font-weight="800" fill="#0f172a">${esc(formatArea(st.area, content.unit))}</text>`;
  }

  // Barra de escala.
  let unitLen = content.unit === 'ft' ? M_PER_FT : 1;
  let n = 1;
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  for (const c of nice) { n = c; if (c * unitLen * k >= 280) break; }
  const sbw = n * unitLen * k;
  const sby = header + drawH - 30;
  const scaleBar = `<g transform="translate(60 ${f1(sby)})"><rect width="${f1(sbw / 2)}" height="10" fill="#1c2533"/><rect x="${f1(sbw / 2)}" width="${f1(sbw / 2)}" height="10" fill="#fff" stroke="#1c2533"/>` +
    `<text x="0" y="-8" font-size="16" fill="#334155">0</text><text x="${f1(sbw)}" y="-8" font-size="16" text-anchor="end" fill="#334155">${n} ${content.unit === 'ft' ? 'ft' : 'm'}</text></g>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, system-ui, Helvetica, Arial, sans-serif">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    `<text x="60" y="64" font-size="40" font-weight="800" fill="#0f172a">${esc(title)}</text>` +
    `<text x="60" y="100" font-size="20" fill="#64748b">${esc(subtitle)}</text>` +
    `<line x1="50" x2="${width - 50}" y1="${header - 6}" y2="${header - 6}" stroke="#e2e8f0" stroke-width="2"/>` +
    `<g transform="matrix(${k} 0 0 ${k} ${v.x} ${v.y})">${buildFills(content)}</g>` +
    buildOverlay(content, v, {}, { export: true }) + scaleBar + legend + `</svg>`;
  return { svg, width, height };
}

import { textureName } from './textures.js';
const textureNameSafe = (f) => (f ? textureName(f) : '—');

// Miniatura só com contornos (lista de pastas).
export function buildThumb(content, W = 240, H = 160) {
  const pts = [];
  for (const s of content.shapes) pts.push(...polygonize(s));
  if (pts.length < 2) return '';
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const k = Math.min((W - 24) / Math.max(x1 - x0, 1e-3), (H - 24) / Math.max(y1 - y0, 1e-3));
  const v = { k, x: (W - (x1 - x0) * k) / 2 - x0 * k, y: (H - (y1 - y0) * k) / 2 - y0 * k };
  const FLAT = { water: '#5bb8e6', concrete: '#cfccc5', grass: '#63a348', asphalt: '#3e4043', gravel: '#b39a7b', deck: '#b07a45', pavers: '#a9a8a3' };
  const shapes = content.shapes.slice().sort((a, b) => shapeArea(b) - shapeArea(a));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">` +
    shapes.map((s) => `<path d="${shapePath(s, v)}" fill="${s.closed ? FLAT[s.fill?.texture] ?? '#fff' : 'none'}" stroke="#1c2533" stroke-width="1.5"/>`).join('') + '</svg>';
}
