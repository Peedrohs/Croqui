// Camada de anotação (instrumentos da paleta da Apple Pencil). Vive em content.markup, em
// coordenadas do mundo — acompanha pan/zoom — e NUNCA entra na geometria, nas medidas nem no solver.
//
// markup = { visible, strokes: [{ id, type, color, width (m), opacity, pressure, pts:[{x,y,p}] }] }
// type: 'pen' | 'pencil' | 'marker' | 'crayon' | 'line' | 'arrow'
import { f3 } from './util.js';
import { distToSegment, pointInPolygon } from './geometry.js';

// Instrumentos: largura em px de tela no momento do traço (vira metros ao desenhar).
export const INSTRUMENTS = [
  { id: 'pen', name: 'Caneta', color: '#1c1c1e', width: 3, opacity: 1, pressure: true },
  { id: 'pencil', name: 'Lapiseira', color: '#48484a', width: 1.4, opacity: 0.9, pressure: true },
  { id: 'marker', name: 'Marca-texto', color: '#ffd60a', width: 18, opacity: 0.4 },
  { id: 'crayon', name: 'Giz', color: '#e0392b', width: 9, opacity: 0.9, pressure: true },
  { id: 'eraser', name: 'Borracha' },
  { id: 'ruler', name: 'Régua', color: '#0a7cff', width: 3, opacity: 1, arrow: true },
  { id: 'lasso', name: 'Laço' },
];
export const DRAW_INSTRUMENTS = ['pen', 'pencil', 'marker', 'crayon', 'ruler'];

export const QUICK_COLORS = ['#ffd60a', '#1c1c1e', '#e0392b', '#0a7cff', '#34c759'];
export const MORE_COLORS = ['#ff9f0a', '#ff375f', '#af52de', '#5e5ce6', '#64d2ff', '#30b0c7', '#a2845e', '#8e8e93', '#ffffff', '#b08d57'];

export const ensureMarkup = (content) => {
  content.markup ??= { visible: true, strokes: [] };
  content.markup.strokes ??= [];
  return content.markup;
};

const pt = (p) => `${f3(p.x)} ${f3(p.y)}`;

// Tinta escura fica invisível no canvas escuro: só NA TELA ela vira clara (a exportação é sempre clara).
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const inkFor = (color, dark) => (dark && /^#[0-9a-f]{6}$/i.test(color) && lum(color) < 0.12 ? '#ececf1' : color);

function arrowHead(a, b, w, color) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L;
  const head = Math.min(L * 0.6, w * 5 + 0.08);
  const base = { x: b.x - ux * head, y: b.y - uy * head };
  const n = { x: -uy * head * 0.45, y: ux * head * 0.45 };
  return {
    base,
    svg: `<path d="M${pt(b)}L${f3(base.x + n.x)} ${f3(base.y + n.y)}L${f3(base.x - n.x)} ${f3(base.y - n.y)}Z" fill="${color}" stroke="${color}" stroke-width="${f3(w * 0.6)}" stroke-linejoin="round"/>`,
  };
}

function smoothPath(pts) {
  if (pts.length < 3) return `M${pts.map(pt).join('L')}`;
  let d = `M${pt(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    d += `Q${pt(pts[i])} ${pt(m)}`;
  }
  return d + `L${pt(pts[pts.length - 1])}`;
}

// Contorno preenchido com meia-largura variável (pressão da Pencil).
function pressureOutline(s, color, extra = '') {
  const P = s.pts;
  const hw = P.map((p) => (s.width / 2) * (0.25 + 1.1 * (p.p ?? 0.5)));
  const sm = hw.map((_, i) => (hw[Math.max(0, i - 1)] + 2 * hw[i] + hw[Math.min(hw.length - 1, i + 1)]) / 4);
  const L = [], R = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    let nx = -(b.y - a.y), ny = b.x - a.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    L.push({ x: P[i].x + nx * sm[i], y: P[i].y + ny * sm[i] });
    R.push({ x: P[i].x - nx * sm[i], y: P[i].y - ny * sm[i] });
  }
  const e = P.length - 1;
  const cap = (p, r) => `M${f3(p.x - r)} ${f3(p.y)}a${f3(r)} ${f3(r)} 0 1 0 ${f3(2 * r)} 0a${f3(r)} ${f3(r)} 0 1 0 ${f3(-2 * r)} 0`;
  return `<path d="${smoothPath(L)}L${smoothPath(R.slice().reverse()).slice(1)}Z${cap(P[0], sm[0])}${cap(P[e], sm[e])}" fill="${color}" ${extra}/>`;
}

// Giz: textura granulada por máscara de ruído (tamanho do grão proporcional à espessura).
function crayonFilter(s) {
  const id = 'cr' + String(s.id).replace(/[^a-z0-9]/gi, '');
  const f = f3(2.2 / Math.max(s.width, 1e-4));
  return {
    id,
    defs: `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%" filterUnits="objectBoundingBox"><feTurbulence type="fractalNoise" baseFrequency="${f}" numOctaves="2" seed="3" result="n"/>` +
      `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.2 1.55" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter>`,
  };
}

export function strokeSVG(s, { dark = false } = {}) {
  if (!s || !s.pts?.length) return '';
  const color = inkFor(s.color, dark);
  const op = s.opacity ?? 1;
  const w = f3(s.width);
  let body = '';
  if (s.type === 'arrow' || s.type === 'line') {
    if (s.pts.length < 2) return '';
    const [a, b] = s.pts;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) return '';
    if (s.type === 'arrow') {
      const h = arrowHead(a, b, s.width, color);
      body = `<path d="M${pt(a)}L${pt(h.base)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" fill="none"/>${h.svg}`;
    } else body = `<path d="M${pt(a)}L${pt(b)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
  } else if (s.pts.length === 1) {
    body = `<circle cx="${f3(s.pts[0].x)}" cy="${f3(s.pts[0].y)}" r="${f3(s.width / 2)}" fill="${color}"/>`;
  } else if (s.type === 'marker') {
    // Marca-texto: ponta chanfrada, largura constante, sem acúmulo de tinta dentro do mesmo traço.
    body = `<path d="${smoothPath(s.pts)}" stroke="${color}" stroke-width="${w}" stroke-linecap="butt" stroke-linejoin="round" fill="none"/>`;
  } else if (s.type === 'crayon') {
    const f = crayonFilter(s);
    body = `<defs>${f.defs}</defs>` + (s.pressure ? pressureOutline(s, color, `filter="url(#${f.id})"`)
      : `<path d="${smoothPath(s.pts)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" fill="none" filter="url(#${f.id})"/>`);
  } else if (s.pressure) {
    body = pressureOutline(s, color);
  } else {
    body = `<path d="${smoothPath(s.pts)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  }
  return op < 1 ? `<g opacity="${op}">${body}</g>` : body;
}

export function markupSVG(markup, opts = {}) {
  if (!markup || markup.visible === false) return '';
  return markup.strokes.map((s) => strokeSVG(s, opts)).join('');
}

// A borracha apaga traços inteiros desta camada (como no Freeform), nunca a geometria.
export function strokeHit(s, p, r) {
  const rr = r + s.width / 2;
  if (s.pts.length === 1) return Math.hypot(p.x - s.pts[0].x, p.y - s.pts[0].y) < rr;
  for (let i = 0; i < s.pts.length - 1; i++) if (distToSegment(p, s.pts[i], s.pts[i + 1]) < rr) return true;
  return false;
}

// Laço: seleciona traços com a maioria dos pontos dentro do contorno desenhado.
export function strokesInLasso(markup, poly) {
  if (poly.length < 3) return [];
  return markup.strokes.filter((s) => {
    const inside = s.pts.filter((p) => pointInPolygon(p, poly)).length;
    return inside >= Math.max(1, s.pts.length * 0.6);
  }).map((s) => s.id);
}

export function strokesBBox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s.pts) {
    const r = s.width / 2;
    x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r); x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r);
  }
  return { x0, y0, x1, y1 };
}

export function markupPoints(markup) {
  if (!markup || markup.visible === false) return [];
  return markup.strokes.flatMap((s) => s.pts);
}
