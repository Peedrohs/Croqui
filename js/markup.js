// Camada de anotação (caneta de marcação, setas). Vive em content.markup, em coordenadas do
// mundo — acompanha pan/zoom — e NUNCA entra na geometria, nas medidas nem no solver.
//
// markup = { visible: bool, strokes: [{ id, type:'pen'|'arrow', color, width (m), pressure: bool, pts:[{x,y,p}] }] }
import { f3 } from './util.js';
import { distToSegment } from './geometry.js';

export const MARK_COLORS = [
  { key: '#e0392b', name: 'Vermelho' },
  { key: '#0a7cff', name: 'Azul' },
  { key: '#f59e0b', name: 'Laranja' },
  { key: '#16a34a', name: 'Verde' },
  { key: '#111827', name: 'Preto' },
];
export const MARK_WIDTHS = [
  { key: 2, name: 'Fino' },
  { key: 4, name: 'Médio' },
  { key: 8, name: 'Grosso' },
];

export const ensureMarkup = (content) => (content.markup ??= { visible: true, strokes: [] });

const pt = (p) => `${f3(p.x)} ${f3(p.y)}`;

function arrowSVG(s) {
  const [a, b] = s.pts;
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return '';
  const ux = dx / L, uy = dy / L;
  const head = Math.min(L * 0.6, s.width * 5 + 0.08);
  const base = { x: b.x - ux * head, y: b.y - uy * head };
  const n = { x: -uy * head * 0.45, y: ux * head * 0.45 };
  return `<path d="M${pt(a)}L${pt(base)}" stroke="${s.color}" stroke-width="${f3(s.width)}" stroke-linecap="round" fill="none"/>` +
    `<path d="M${pt(b)}L${f3(base.x + n.x)} ${f3(base.y + n.y)}L${f3(base.x - n.x)} ${f3(base.y - n.y)}Z" fill="${s.color}" stroke="${s.color}" stroke-width="${f3(s.width * 0.6)}" stroke-linejoin="round"/>`;
}

// Traço com espessura constante: curva suavizada pelos pontos médios.
function smoothPath(pts) {
  if (pts.length < 3) return `M${pts.map(pt).join('L')}`;
  let d = `M${pt(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    d += `Q${pt(pts[i])} ${pt(m)}`;
  }
  return d + `L${pt(pts[pts.length - 1])}`;
}

// Traço sensível à pressão: contorno preenchido com meia-largura variável.
function pressureOutline(s) {
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
  return `<path d="${smoothPath(L)}L${smoothPath(R.slice().reverse()).slice(1)}Z${cap(P[0], sm[0])}${cap(P[e], sm[e])}" fill="${s.color}"/>`;
}

export function strokeSVG(s) {
  if (!s || !s.pts?.length) return '';
  if (s.type === 'arrow') return s.pts.length === 2 ? arrowSVG(s) : '';
  if (s.pts.length === 1) return `<circle cx="${f3(s.pts[0].x)}" cy="${f3(s.pts[0].y)}" r="${f3(s.width / 2)}" fill="${s.color}"/>`;
  if (s.pressure) return pressureOutline(s);
  return `<path d="${smoothPath(s.pts)}" stroke="${s.color}" stroke-width="${f3(s.width)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
}

export function markupSVG(markup) {
  if (!markup || markup.visible === false) return '';
  return `<g opacity=".92">${markup.strokes.map(strokeSVG).join('')}</g>`;
}

// A borracha apaga traços inteiros desta camada (como no Freeform), nunca a geometria.
export function strokeHit(s, p, r) {
  const rr = r + s.width / 2;
  if (s.pts.length === 1) return Math.hypot(p.x - s.pts[0].x, p.y - s.pts[0].y) < rr;
  for (let i = 0; i < s.pts.length - 1; i++) if (distToSegment(p, s.pts[i], s.pts[i + 1]) < rr) return true;
  return false;
}

export function markupPoints(markup) {
  if (!markup || markup.visible === false) return [];
  return markup.strokes.flatMap((s) => s.pts);
}
