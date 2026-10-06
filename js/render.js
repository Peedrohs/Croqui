// Montagem do SVG. Texturas em coordenadas do mundo (um <g> com transform);
// linhas, cotas e textos em coordenadas de tela, para ficarem nítidos em qualquer zoom.
import { f1, esc, vertexLabel } from './util.js';
import { polygonize, segmentCount, segInfo, orientation, sub, add, mul, norm, labelPoint, shapeArea, expandFillets, filletInfo } from './geometry.js';
import { formatLength, formatArea, M_PER_FT } from './units.js';
import { renderFill } from './textures.js';
import { rightAngleVertices } from './solver.js';
import { stats } from './model.js';
import { CANVAS_LIGHT } from './theme.js';
import { sharedEdges, visiblePieces, hiddenFraction } from './areas.js';

// Paleta ativa (tela: tema atual; exportação: sempre clara). Definida no início de cada build.
let C = CANVAS_LIGHT;

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
export function buildFills(content, palette = CANVAS_LIGHT) {
  const closed = content.shapes.filter((s) => s.closed && s.vertices.length >= 3);
  closed.sort((a, b) => shapeArea(b) - shapeArea(a));
  let out = '';
  for (const s of closed) {
    const poly = polygonize(s);
    if (s.fill) out += renderFill(poly, s.fill, s.id);
    else out += `<path d="M${poly.map((p) => `${p.x} ${p.y}`).join('L')}Z" fill="${palette.emptyFill}" fill-opacity=".85"/>`;
  }
  return out + buildObjectFills(content);
}

// ---------- Grade de pontos (tela), como no Freeform ----------
// Um <pattern> alinhado ao pan: custa um único retângulo por quadro, em qualquer zoom.
export function buildGrid(view, w, h, unit, palette = CANVAS_LIGHT) {
  let step = unit === 'ft' ? M_PER_FT : 1;
  const major = unit === 'ft' ? 10 : 5;
  while (step * view.k < 16) step *= major;
  const sp = step * view.k;
  const ox = ((view.x % sp) + sp) % sp, oy = ((view.y % sp) + sp) % sp;
  const MS = sp * major;
  const mx = ((view.x % MS) + MS) % MS, my = ((view.y % MS) + MS) % MS;
  return `<defs><pattern id="gdot" width="${f1(sp)}" height="${f1(sp)}" patternUnits="userSpaceOnUse" x="${f1(ox)}" y="${f1(oy)}">` +
    `<circle cx="0" cy="0" r="1.1" fill="${palette.dot}"/><circle cx="${f1(sp)}" cy="0" r="1.1" fill="${palette.dot}"/><circle cx="0" cy="${f1(sp)}" r="1.1" fill="${palette.dot}"/><circle cx="${f1(sp)}" cy="${f1(sp)}" r="1.1" fill="${palette.dot}"/></pattern>` +
    `<pattern id="gdotM" width="${f1(MS)}" height="${f1(MS)}" patternUnits="userSpaceOnUse" x="${f1(mx)}" y="${f1(my)}">` +
    `<circle cx="0" cy="0" r="1.8" fill="${palette.dotMajor}"/><circle cx="${f1(MS)}" cy="0" r="1.8" fill="${palette.dotMajor}"/><circle cx="0" cy="${f1(MS)}" r="1.8" fill="${palette.dotMajor}"/><circle cx="${f1(MS)}" cy="${f1(MS)}" r="1.8" fill="${palette.dotMajor}"/></pattern></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#gdot)"/>${MS < Math.max(w, h) * 2 ? `<rect width="${w}" height="${h}" fill="url(#gdotM)"/>` : ''}`;
}

// Anexos (fotos de referência), em coordenadas do mundo, abaixo das texturas.
export function buildImages(content, ui = {}) {
  return (content.images || []).map((im) =>
    `<image href="${im.src}" x="${im.x}" y="${im.y}" width="${im.w}" height="${im.h}" opacity="${im.opacity ?? 0.8}" preserveAspectRatio="none"/>`).join('');
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

// Trecho visível do segmento i (com cantos arredondados, a parede reta fica mais curta).
function visSegPath(shape, i, v) {
  const ex = expandFillets(shape);
  return ex === shape ? segPath(shape, i, v) : segPath(ex, ex.map[i], v);
}

// Contorno sem os trechos ocultos (divisa compartilhada com outra área, vãos de portas…).
function outlinePath(shape, v, hidden) {
  const ex = expandFillets(shape);
  const m = segmentCount(ex);
  if (!m) return '';
  if (![...Array(m).keys()].some((j) => hidden.has(shape.id + ':' + j))) return shapePath(shape, v);
  let d = '';
  for (let j = 0; j < m; j++) {
    const iv = hidden.get(shape.id + ':' + j);
    if (!iv) { d += segPath(ex, j, v, true); continue; }
    const a = ex.vertices[j], b = ex.vertices[(j + 1) % ex.vertices.length];
    for (const [t0, t1] of visiblePieces(iv)) {
      const p = S({ x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 }, v), q = S({ x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 }, v);
      d += `M${f1(p.x)} ${f1(p.y)}L${f1(q.x)} ${f1(q.y)}`;
    }
  }
  return d;
}

// Fração oculta da parede i ORIGINAL (para esconder também a cota da divisa).
function hiddenOfSeg(shape, i, hidden) {
  const ex = expandFillets(shape);
  const j = ex === shape ? i : ex.map[i];
  return hiddenFraction(hidden.get(shape.id + ':' + j));
}

export function shapePath(shape, v) {
  shape = expandFillets(shape);
  const m = segmentCount(shape);
  if (!m) return '';
  let d = '';
  for (let i = 0; i < m; i++) d += segPath(shape, i, v, i === 0);
  return d + (shape.closed ? 'Z' : '');
}

// ---------- Cotas ----------
function label(x, y, angDeg, text, { color, weight = 600, px = 14, bg = C.labelBg, border = null, hit = '' } = {}) {
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
  const px = opts.export ? 22 : opts.dimPx || 14;
  for (let i = 0; i < m; i++) {
    const seg = shape.segments[i];
    const info = segInfo(shape, i);
    const live = opts.live?.shapeId === shape.id && opts.live.segs.includes(i);
    if (!live && opts.hidden && hiddenOfSeg(shape, i, opts.hidden) > 0.95) continue; // cota da divisa oculta
    const a = S(info.p0, v), b = S(info.p1, v);
    const dd = sub(b, a);
    const L = Math.hypot(dd.x, dd.y);
    if (L < 6) continue;
    const d = norm(dd);
    const nL = { x: -d.y, y: d.x };
    const out1 = shape.closed ? (orient > 0 ? mul(nL, -1) : nL) : mul(nL, -1);
    const measured = seg.length != null;
    const bad = report?.badSegments?.includes(i);
    let color = bad ? C.bad : measured ? C.measured : C.approx;
    let text = measured ? formatLength(seg.length, unit) : content.calibrated ? '~' + formatLength(info.chord, unit) : '?';
    if (bad) text = '⚠ ' + text;
    // Arrastando um vértice: mostra o comprimento ao vivo (e a medida travada, se houver).
    if (live && content.calibrated) {
      const cur = formatLength(info.chord, unit);
      text = measured && cur !== formatLength(seg.length, unit) ? `${cur} · 🔒 ${formatLength(seg.length, unit)}` : cur;
      color = C.accent;
    }
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
      out += label(P.x, P.y, ang, text, { color, weight: measured ? 700 : 500, px, border: bad ? C.bad : null, hit });
    } else {
      // Arco: cota da corda (tracejada) + flecha junto ao arco.
      out += `<path d="M${f1(a.x)} ${f1(a.y)}L${f1(b.x)} ${f1(b.y)}" stroke="${color}" stroke-width="1" stroke-dasharray="4 4" opacity=".6"/>`;
      const mid = add(a, mul(dd, 0.5));
      out += label(mid.x, mid.y, ang, 'C ' + text, { color, weight: measured ? 700 : 500, px, border: bad ? C.bad : null, hit });
      const M = S(info.arc.M, v);
      const bdir = mul(info.arc.nrm, Math.sign(seg.bulge));
      const P = add(M, mul(bdir, 18));
      const ftxt = seg.sagitta != null ? 'f ' + formatLength(Math.abs(seg.sagitta), unit) : content.calibrated ? 'f ~' + formatLength(Math.abs(info.arc.sagitta), unit) : '';
      if (ftxt) out += label(P.x, P.y, ang, ftxt, { color: seg.sagitta != null ? C.measured : C.approx, weight: 500, px: px - 2, hit });
    }
  }
  // Cantos arredondados: raio + comprimento do arco, do lado de fora do canto.
  const ex = expandFillets(shape);
  for (const a of ex.arcs || []) {
    const f = a.info;
    const M = S(sub(f.center, mul(f.bis, f.r)), v);
    if (f.r * v.k < 4) continue;
    const txt = content.calibrated ? `R ${formatLength(f.r, unit)} · ⌒ ${formatLength(f.length, unit)}` : 'R ?';
    // Por dentro do arco (fora ficam as cotas das paredes); conta a largura do texto.
    const half = (textWidth(txt, px - 1) + 10) / 2;
    const P = add(M, mul(f.bis, (opts.export ? 30 : 20) + half * Math.abs(f.bis.x)));
    const hit = opts.export ? '' : `data-hit="fillet" data-s="${shape.id}" data-i="${f.i}"`;
    out += label(P.x, P.y, 0, txt, { color: f.clamped ? C.bad : C.measured, weight: 600, px: px - 1, hit });
  }
  return out;
}

function rightMarks(shape, v, big) {
  const n = shape.vertices.length;
  let d = '';
  for (const i of rightAngleVertices(shape)) {
    if (filletInfo(shape, i)) continue;
    const a = S(shape.vertices[(i - 1 + n) % n], v), b = S(shape.vertices[i], v), c = S(shape.vertices[(i + 1) % n], v);
    const u = norm(sub(a, b)), w = norm(sub(c, b));
    const s = big ? 16 : 9;
    const p1 = add(b, mul(u, s)), p2 = add(add(b, mul(u, s)), mul(w, s)), p3 = add(b, mul(w, s));
    d += `M${f1(p1.x)} ${f1(p1.y)}L${f1(p2.x)} ${f1(p2.y)}L${f1(p3.x)} ${f1(p3.y)}`;
  }
  return d ? `<path d="${d}" stroke="${C.ink}" stroke-width="1" fill="none" opacity=".55"/>` : '';
}

function areaLabel(content, shape, v, st, opts) {
  if (opts.showArea === false && !opts.export) return shape.name && shape.closed ? label(...Object.values(S(labelPoint(polygonize(shape)), v)), 0, shape.name, { color: C.ink, px: 13 }) : '';
  if (!shape.closed || shape.vertices.length < 3) return '';
  const c = S(labelPoint(polygonize(shape)), v);
  if (!content.calibrated && !opts.export) return shape.name ? label(c.x, c.y, 0, shape.name, { color: C.ink, px: 13 }) : '';
  const s = st.per[shape.id];
  const useNet = opts.netArea !== false;
  const shown = useNet ? s.net : s.net + (s.objArea || 0);
  const areaTxt = formatArea(shown, content.unit) + (Math.abs(shown - s.area) > 1e-9 ? ' (líq.)' : '');
  const px = opts.export ? 22 : 13;
  let o = '';
  if (shape.name) o += label(c.x, c.y - px, 0, shape.name, { color: C.ink, px, weight: 700 });
  o += label(c.x, c.y + (shape.name ? px * 0.9 : 0), 0, areaTxt, { color: C.areaInk, px: px - 1, weight: 500, bg: C.labelSoft });
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
    o += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" rx="6" fill="${C.noteBg}" fill-opacity=".94" stroke="${sel ? C.accent : C.noteBorder}" stroke-width="${sel ? 2 : 1}" ${sel ? '' : 'stroke-dasharray="3 3"'}/>`;
    lines.forEach((ln, i) => {
      o += `<text x="${f1(x + px * 0.3)}" y="${f1(y + px * 0.3 + px * (i + 0.95) * 1.25 - px * 0.25)}" font-size="${f1(px)}" fill="${C.ink}">${esc(ln)}</text>`;
    });
    o += '</g>';
    if (sel) o += `<g data-hit="textresize" data-t="${t.id}"><circle cx="${f1(x + w)}" cy="${f1(y + h)}" r="16" fill="transparent"/><rect x="${f1(x + w - 7)}" y="${f1(y + h - 7)}" width="14" height="14" rx="3" fill="${C.accent}" stroke="${C.handle}" stroke-width="2"/></g>`;
  }
  return o;
}

/**
 * ui = { sel, tool, reports, drawing:{shapeId, preview, snap, closeHint}, freehand:[pts] }
 * opts = { export:bool }
 */
export function buildOverlay(content, v, ui = {}, opts = {}) {
  C = opts.export ? CANVAS_LIGHT : opts.palette || CANVAS_LIGHT;
  const st = stats(content);
  let o = '';
  const selShape = ui.sel && ui.sel.shapeId;
  // Divisas coincidentes entre áreas: não desenha (as duas áreas parecem um contorno só).
  // A área selecionada mostra o contorno inteiro, para você ver o que é dela.
  syncWallObjects(content);
  const hidden = sharedEdges(content, Math.max(1e-3, 1.5 / v.k));
  // Vãos de portas/janelas: abrem a linha da parede (também na área selecionada).
  const gaps = new Map();
  for (const g of wallGaps(content)) {
    const sh = content.shapes.find((x) => x.id === g.shapeId);
    if (!sh) continue;
    const ex = expandFillets(sh);
    const j = ex === sh ? g.seg : ex.map[g.seg];
    if (j == null) continue;
    const a = ex.vertices[j], b = ex.vertices[(j + 1) % ex.vertices.length];
    const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (L2 < 1e-12) continue;
    const tp = (P) => ((P.x - a.x) * (b.x - a.x) + (P.y - a.y) * (b.y - a.y)) / L2;
    const iv = [Math.min(tp(g.A), tp(g.B)), Math.max(tp(g.A), tp(g.B))];
    for (const M of [hidden, gaps]) { const k = sh.id + ':' + j; if (!M.has(k)) M.set(k, []); M.get(k).push(iv); }
  }
  const noHide = new Map();
  for (const s of content.shapes) {
    const d = outlinePath(s, v, s.id === selShape && !opts.export ? gaps : hidden);
    if (!d) continue;
    const isSel = s.id === selShape && !opts.export;
    const report = ui.reports?.[s.id];
    o += `<path d="${d}" fill="none" stroke="${isSel ? C.accent : C.ink}" stroke-width="${opts.export ? 3 : 2.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (report?.badSegments?.length && !opts.export) {
      for (const i of report.badSegments) o += `<path d="${visSegPath(s, i, v)}" fill="none" stroke="${C.bad}" stroke-width="4" stroke-linecap="round"/>`;
    }
    if (!opts.export) {
      for (let i = 0, m = segmentCount(s); i < m; i++) {
        const segSel = ui.sel?.kind === 'seg' && ui.sel.shapeId === s.id && ui.sel.i === i;
        if (segSel) {
          const [e0, e1] = [S(s.vertices[i], v), S(s.vertices[(i + 1) % s.vertices.length], v)];
          o += `<path d="${visSegPath(s, i, v)}" fill="none" stroke="${C.accentFill}" stroke-width="9" stroke-linecap="round" opacity=".35"/>` +
            `<path d="${visSegPath(s, i, v)}" fill="none" stroke="${C.accent}" stroke-width="3.5" stroke-linecap="round"/>` +
            [e0, e1].map((q) => `<circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="11" fill="${C.accentFill}" fill-opacity=".25"/><circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="6.5" fill="${C.accent}" stroke="${C.handle}" stroke-width="2.5"/>`).join('');
        }
        o += `<path d="${visSegPath(s, i, v)}" fill="none" stroke="transparent" stroke-width="28" data-hit="seg" data-s="${s.id}" data-i="${i}"/>`;
      }
      const ex = expandFillets(s);
      for (const a of ex.arcs || []) {
        const fSel = ui.sel?.kind === 'fillet' && ui.sel.shapeId === s.id && ui.sel.i === a.vertex;
        const pth = segPath(ex, a.seg, v);
        if (fSel) o += `<path d="${pth}" fill="none" stroke="${C.accentFill}" stroke-width="9" stroke-linecap="round" opacity=".35"/><path d="${pth}" fill="none" stroke="${C.accent}" stroke-width="3.5" stroke-linecap="round"/>`;
        o += `<path d="${pth}" fill="none" stroke="transparent" stroke-width="28" data-hit="fillet" data-s="${s.id}" data-i="${a.vertex}"/>`;
      }
    }
    o += rightMarks(s, v, opts.export);
  }
  o += objectsOverlay(content, v, ui, opts);
  const dopts = { ...opts, live: ui.live };
  for (const s of content.shapes) o += dims(content, s, v, ui.reports?.[s.id], { ...dopts, hidden: s.id === selShape && !opts.export ? noHide : hidden });
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
          `<circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="${vSel ? 9 : r}" fill="${vSel ? C.accent : C.handle}" stroke="${bad ? C.bad : active ? C.accent : C.ink}" stroke-width="2"/></g>`;
        if (s.id === selShape) o += `<text x="${f1(q.x + 10)}" y="${f1(q.y - 10)}" font-size="12" font-weight="700" fill="${C.accent}" style="paint-order:stroke" stroke="${C.halo}" stroke-width="3">${vertexLabel(i)}</text>`;
      });
      if (s.id === selShape) {
        // Canto arredondado: canto "vivo" pontilhado + alça redonda no meio do arco (arraste = raio).
        for (const a of expandFillets(s).arcs || []) {
          const f = a.info, cq = S(s.vertices[f.i], v), t1 = S(f.T1, v), t2 = S(f.T2, v), q = S(sub(f.center, mul(f.bis, f.r)), v);
          o += `<path d="M${f1(t1.x)} ${f1(t1.y)}L${f1(cq.x)} ${f1(cq.y)}L${f1(t2.x)} ${f1(t2.y)}" fill="none" stroke="${C.accent}" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>` +
            `<g data-hit="fillet" data-s="${s.id}" data-i="${f.i}"><circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="20" fill="transparent"/><circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="6.5" fill="${C.handle}" stroke="${C.accent}" stroke-width="2.5"/></g>`;
        }
        for (let i = 0, m = segmentCount(s); i < m; i++) {
          const info = segInfo(s, i);
          if (!info.arc) continue;
          const q = S(info.arc.M, v);
          o += `<g data-hit="bulge" data-s="${s.id}" data-i="${i}"><circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="20" fill="transparent"/>` +
            `<rect x="${f1(q.x - 6)}" y="${f1(q.y - 6)}" width="12" height="12" transform="rotate(45 ${f1(q.x)} ${f1(q.y)})" fill="${C.handle}" stroke="${C.accent}" stroke-width="2"/></g>`;
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
          o += `<path d="M${f1(last.x)} ${f1(last.y)}A${f1(r)} ${f1(r)} 0 0 0 ${f1(q.x)} ${f1(q.y)}" stroke="${C.accent}" stroke-width="2" stroke-dasharray="6 5" fill="none"/>`;
        } else o += `<path d="M${f1(last.x)} ${f1(last.y)}L${f1(q.x)} ${f1(q.y)}" stroke="${C.accent}" stroke-width="2" stroke-dasharray="6 5"/>`;
        if (content.calibrated) {
          const L = Math.hypot(dr.preview.x - s.vertices[s.vertices.length - 1].x, dr.preview.y - s.vertices[s.vertices.length - 1].y);
          o += label((last.x + q.x) / 2, (last.y + q.y) / 2 - 18, 0, '~' + formatLength(L, content.unit), { color: C.accent, px: 13 });
        }
        if (dr.closeHint) {
          const f = S(s.vertices[0], v);
          o += `<circle cx="${f1(f.x)}" cy="${f1(f.y)}" r="16" fill="${C.accent}" fill-opacity=".15" stroke="${C.accent}" stroke-width="2"/>`;
        }
      }
      if (dr.guide) {
        const g0 = S(dr.guide[0], v);
        o += `<path d="M${f1(g0.x)} ${f1(g0.y)}L${f1(q.x)} ${f1(q.y)}" stroke="${C.guide}" stroke-width="1" stroke-dasharray="2 4"/>`;
      }
      o += `<circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="6" fill="${dr.snap ? C.guide : C.accent}" stroke="${C.handle}" stroke-width="2"/>`;
    }
    // Pontas soltas (tracejado) e pontos quase juntos (anel fino pulsando, tocável para unir só aquele).
    for (const e of ui.loose?.ends || []) {
      const sh = content.shapes.find((x) => x.id === e.shapeId);
      if (!sh) continue;
      const q = S(sh.vertices[e.i], v);
      o += `<circle class="loose" cx="${f1(q.x)}" cy="${f1(q.y)}" r="12" fill="none" stroke="${C.bad}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    }
    (ui.loose?.clusters || []).forEach((cl, k) => {
      const c = S(cl.center, v);
      let r = 0;
      for (const m of cl.members) {
        const sh = content.shapes.find((x) => x.id === m.shapeId);
        if (sh) r = Math.max(r, Math.hypot(S(sh.vertices[m.i], v).x - c.x, S(sh.vertices[m.i], v).y - c.y));
      }
      r = Math.max(16, r + 11);
      o += `<g data-hit="pair" data-i="${k}"><circle cx="${f1(c.x)}" cy="${f1(c.y)}" r="${f1(r)}" fill="none" stroke="transparent" stroke-width="18" pointer-events="stroke"/>` +
        `<circle class="join-ring" cx="${f1(c.x)}" cy="${f1(c.y)}" r="${f1(r)}" fill="none" stroke="${C.bad}" stroke-width="1.6" pointer-events="none"/></g>`;
    });
    // Guias de encaixe (alinhamento, extensão de parede) e realce do encaixe.
    for (const g of ui.guides || []) {
      const a = S(g[0], v), b = S(g[1], v);
      o += `<path d="M${f1(a.x)} ${f1(a.y)}L${f1(b.x)} ${f1(b.y)}" stroke="${C.guide}" stroke-width="1.2" stroke-dasharray="3 4"/>`;
    }
    if (ui.snapEdge) {
      const a = S(ui.snapEdge[0], v), b = S(ui.snapEdge[1], v);
      o += `<path d="M${f1(a.x)} ${f1(a.y)}L${f1(b.x)} ${f1(b.y)}" stroke="${C.guide}" stroke-width="7" stroke-linecap="round" opacity=".35"/>`;
    }
    if (ui.snapRing) {
      const q = S(ui.snapRing, v);
      o += `<circle cx="${f1(q.x)}" cy="${f1(q.y)}" r="15" fill="${C.guide}" fill-opacity=".18" stroke="${C.guide}" stroke-width="2.5"/>`;
    }
    if (ui.freehand?.length > 1) {
      const pts = ui.freehand.map((p) => S(p, v));
      o += `<path d="M${pts.map((p) => `${f1(p.x)} ${f1(p.y)}`).join('L')}" stroke="${C.accent}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`;
    }
  }
  return o;
}

// ---------- Exportação: SVG completo e autossuficiente ----------
export function buildExportSVG(content, { title = '', subtitle = '', project = '', date = '', logo = null, width = 2200, includeMarkup = true, netArea = true } = {}) {
  const st = stats(content);
  const pts = [];
  for (const s of content.shapes) pts.push(...polygonize(s));
  for (const t of content.texts) pts.push({ x: t.x, y: t.y }, { x: t.x + t.w, y: t.y + t.size * 3 });
  for (const im of content.images || []) pts.push({ x: im.x, y: im.y }, { x: im.x + im.w, y: im.y + im.h });
  for (const ob of content.objects || []) pts.push(...objectOutline(ob));
  if (includeMarkup) pts.push(...markupPoints(content.markup));
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
  const footerH = 110;
  const height = Math.round(header + drawH + legendH + footerH);
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
        `<text x="${cols[2]}" y="${y + 26}" font-size="20" fill="#0f172a">${esc(formatArea(netArea ? p.net : p.net + (p.objArea || 0), content.unit))}${p.objArea && netArea ? ` líq. (bruta ${esc(formatArea(p.area, content.unit))})` : ''}</text>` +
        `<text x="${cols[3]}" y="${y + 26}" font-size="20" fill="#0f172a">${esc(formatLength(p.perimeter, content.unit))}</text>`;
      y += rowH;
    });
    legend += `<line x1="50" x2="${width - 50}" y1="${y}" y2="${y}" stroke="#94a3b8"/>`;
    legend += `<text x="${cols[0]}" y="${y + 28}" font-size="21" font-weight="800" fill="#0f172a">Total</text><text x="${cols[2]}" y="${y + 28}" font-size="21" font-weight="800" fill="#0f172a">${esc(formatArea(netArea ? st.areaNet : st.area, content.unit))}${netArea && st.objArea ? ' líquida' : ''}</text>`;
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
    (subtitle ? `<text x="60" y="100" font-size="20" fill="#64748b">${esc(subtitle)}</text>` : '') +
    `<line x1="50" x2="${width - 50}" y1="${header - 6}" y2="${header - 6}" stroke="#e2e8f0" stroke-width="2"/>` +
    `<g transform="matrix(${k} 0 0 ${k} ${v.x} ${v.y})">${buildImages(content)}${buildFills(content, CANVAS_LIGHT)}</g>` +
    buildOverlay(content, v, {}, { export: true, netArea }) +
    (includeMarkup ? `<g transform="matrix(${k} 0 0 ${k} ${v.x} ${v.y})">${markupSVG(content.markup)}</g>` : '') +
    scaleBar + legend + exportFooter(width, height - footerH, footerH, { project: project || title, date, logo }) + `</svg>`;
  return { svg, width, height };
}

import { textureName } from './textures.js';
import { markupSVG, markupPoints } from './markup.js';
import { buildObjectFills, objectOutline, objectType, isWallObject, wallSymbolSVG, wallGaps, syncWallObjects } from './objects.js';
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

// Rodapé do documento: logo discreta à esquerda, projeto e data à direita.
function exportFooter(W, y, H, { project, date, logo }) {
  const lh = 46, lw = logo ? Math.round((lh * logo.w) / logo.h) : 0;
  return `<g transform="translate(0 ${y})"><line x1="50" x2="${W - 50}" y1="18" y2="18" stroke="#e5e2da" stroke-width="2"/>` +
    (logo ? `<image href="${logo.src}" x="60" y="${18 + (H - 18 - lh) / 2}" width="${lw}" height="${lh}" opacity=".9"/>` : '') +
    `<text x="${W - 60}" y="${18 + H / 2 - 4}" font-size="20" font-weight="700" fill="#1c1c1e" text-anchor="end">${esc(project)}</text>` +
    `<text x="${W - 60}" y="${18 + H / 2 + 22}" font-size="17" fill="#6b6b70" text-anchor="end">${esc(date)}</text></g>`;
}

// Colunas/objetos: contorno, cotas (opcionais por objeto) e alças quando selecionado.
// Porta / janela / porta de correr / garagem: símbolo + toque + largura do vão.
function wallObjectOverlay(content, ob, v, ui, opts, px) {
  const sel = !opts.export && ui.sel?.kind === 'obj' && ui.sel.id === ob.id;
  let o = wallSymbolSVG(ob, (q) => S(q, v), v.k, { ink: sel ? C.accent : C.ink });
  if (!opts.export) {
    const poly = objectOutline(ob).map((q) => S(q, v));
    o += `<path d="M${poly.map((q) => `${f1(q.x)} ${f1(q.y)}`).join('L')}Z" fill="transparent" stroke="transparent" stroke-width="12" data-hit="obj" data-t="${ob.id}"/>`;
    if (sel) o += `<path d="M${poly.map((q) => `${f1(q.x)} ${f1(q.y)}`).join('L')}Z" fill="${C.accent}" fill-opacity=".06" stroke="${C.accent}" stroke-width="1" stroke-dasharray="4 4"/>`;
  }
  if (ob.showDims) {
    const a = ((ob.rot || 0) * Math.PI) / 180, u = { x: Math.cos(a), y: Math.sin(a) };
    // Do lado de dentro da área: por fora ficam as cotas das paredes.
    const n = mul({ x: -u.y, y: u.x }, ob.inward || 1);
    const deep = ob.type === 'garage' ? ob.size.w * 0.14 * v.k + px : px + 8;
    const c = add(S({ x: ob.x, y: ob.y }, v), mul(n, deep));
    const txt = formatLength(ob.size.w, content.unit) + (ob.type === 'garage' ? ` · ${ob.cars || 2} carro${(ob.cars || 2) > 1 ? 's' : ''}` : '');
    o += label(c.x, c.y, upright(u), txt, { color: C.measured, px, weight: 600 });
  }
  return o;
}

function objectsOverlay(content, v, ui, opts) {
  let o = '';
  const unit = content.unit;
  const px = opts.export ? 18 : Math.max(11, (opts.dimPx || 14) - 2);
  for (const ob of content.objects || []) {
    if (isWallObject(ob)) { o += wallObjectOverlay(content, ob, v, ui, opts, px); continue; }
    const poly = objectOutline(ob).map((q) => S(q, v));
    const d = 'M' + poly.map((q) => `${f1(q.x)} ${f1(q.y)}`).join('L') + 'Z';
    const sel = !opts.export && ui.sel?.kind === 'obj' && ui.sel.id === ob.id;
    o += `<path d="${d}" fill="none" stroke="${sel ? C.accent : C.ink}" stroke-width="${sel ? 2.5 : opts.export ? 2.2 : 1.8}"/>`;
    if (!opts.export) o += `<path d="${d}" fill="transparent" stroke="transparent" stroke-width="16" data-hit="obj" data-t="${ob.id}"/>`;
    const c = S({ x: ob.x, y: ob.y }, v);
    if (ob.showDims) {
      const T = objectType(ob);
      if (ob.size.d != null) {
        const r = (ob.size.d / 2) * v.k;
        o += label(c.x, c.y + r + px, 0, '⌀ ' + formatLength(ob.size.d, unit), { color: C.measured, px, weight: 600 });
      } else {
        const a = ((ob.rot || 0) * Math.PI) / 180, ux = { x: Math.cos(a), y: Math.sin(a) }, uy = { x: -Math.sin(a), y: Math.cos(a) };
        const hw = (ob.size.w / 2) * v.k, hh = (ob.size.h / 2) * v.k;
        const top = add(c, mul(uy, -(hh + px))), side = add(c, mul(ux, hw + px * 1.2));
        o += label(top.x, top.y, upright(ux), formatLength(ob.size.w, unit), { color: C.measured, px, weight: 600 });
        o += label(side.x, side.y, upright(uy), formatLength(ob.size.h, unit), { color: C.measured, px, weight: 600 });
      }
      void T;
    }
    if (sel && objectType(ob).rotatable) {
      const a = ((ob.rot || 0) * Math.PI) / 180, uy = { x: -Math.sin(a), y: Math.cos(a) };
      const hh = (ob.size.h / 2) * v.k;
      const h = add(c, mul(uy, -(hh + 34)));
      o += `<path d="M${f1(c.x - uy.x * hh * -1)} ${f1(c.y + uy.y * -hh)}L${f1(h.x)} ${f1(h.y)}" stroke="${C.accent}" stroke-width="1.5"/>` +
        `<g data-hit="objrot" data-t="${ob.id}"><circle cx="${f1(h.x)}" cy="${f1(h.y)}" r="20" fill="transparent"/><circle cx="${f1(h.x)}" cy="${f1(h.y)}" r="8" fill="${C.handle}" stroke="${C.accent}" stroke-width="2.5"/></g>`;
    }
  }
  return o;
}
