// Objetos independentes do contorno (colunas; depois degraus, ralos, canteiros, postes…).
// Cada tipo é uma entrada do registro OBJECT_TYPES — para criar um tipo novo basta descrever
// tamanho padrão, contorno em planta, campos de dimensão e cotas.
//
// Objeto = { id, type, x, y (centro, m), rot (graus), size: {d} | {w, h}, fill, showDims, subtract }
// Elementos de parede (porta, janela, porta de correr, garagem) têm wall:true e ficam presos a uma
// parede: host = { shapeId, seg, t (0..1 ao longo da parede), nseg }; x/y/rot são derivados dela.
import { uid, f1, f3 } from './util.js';
import { M_PER_FT } from './units.js';
import { pointInPolygon, signedArea, segmentCount, polygonize, dist, sub, add, mul, dot } from './geometry.js';
import { renderFill } from './textures.js';

const ftOrM = (unit, ft, m) => (unit === 'ft' ? ft * M_PER_FT : m);

export const OBJECT_TYPES = {
  'column-round': {
    name: 'Coluna redonda',
    category: 'Colunas',
    defaults: (unit) => ({ size: { d: ftOrM(unit, 1, 0.3) } }),
    fields: [{ key: 'd', label: 'Diâmetro' }],
    rotatable: false,
    outline(o, steps = 48) {
      const r = o.size.d / 2;
      return Array.from({ length: steps }, (_, i) => {
        const a = (i / steps) * Math.PI * 2;
        return { x: o.x + r * Math.cos(a), y: o.y + r * Math.sin(a) };
      });
    },
    half: (o) => ({ w: o.size.d / 2, h: o.size.d / 2 }),
  },
  'column-square': {
    name: 'Coluna quadrada',
    category: 'Colunas',
    defaults: (unit) => ({ size: { w: ftOrM(unit, 1, 0.3), h: ftOrM(unit, 1, 0.3) } }),
    fields: [{ key: 'w', label: 'Largura' }, { key: 'h', label: 'Profundidade' }],
    rotatable: true,
    outline: rectOutline,
    half: (o) => ({ w: o.size.w / 2, h: o.size.h / 2 }),
  },
  'column-rect': {
    name: 'Coluna retangular',
    category: 'Colunas',
    defaults: (unit) => ({ size: { w: ftOrM(unit, 1, 0.3), h: ftOrM(unit, 2, 0.6) } }),
    fields: [{ key: 'w', label: 'Largura' }, { key: 'h', label: 'Profundidade' }],
    rotatable: true,
    outline: rectOutline,
    half: (o) => ({ w: o.size.w / 2, h: o.size.h / 2 }),
  },
  door: {
    name: 'Porta', category: 'Aberturas', wall: true,
    defaults: (unit) => ({ size: { w: ftOrM(unit, 3, 0.8) }, flip: false, swing: 1 }),
    fields: [{ key: 'w', label: 'Largura do vão' }],
    depth: (o) => [Math.min(0, (o.swing || 1) * o.size.w) - 0.1, Math.max(0, (o.swing || 1) * o.size.w) + 0.1],
  },
  window: {
    name: 'Janela', category: 'Aberturas', wall: true,
    defaults: (unit) => ({ size: { w: ftOrM(unit, 4, 1.2) } }),
    fields: [{ key: 'w', label: 'Largura do vão' }],
    depth: () => [-0.25, 0.25],
  },
  slider: {
    name: 'Porta de correr', category: 'Aberturas', wall: true,
    defaults: (unit) => ({ size: { w: ftOrM(unit, 6, 1.8) } }),
    fields: [{ key: 'w', label: 'Largura do vão' }],
    depth: () => [-0.25, 0.25],
  },
  garage: {
    name: 'Porta de garagem', category: 'Aberturas', wall: true,
    defaults: (unit) => ({ size: { w: ftOrM(unit, 16, 4.9) }, cars: 2 }),
    fields: [{ key: 'w', label: 'Largura do vão' }],
    depth: (o) => [-0.15, o.size.w * 0.14 + 0.15],
  },
};

// Elementos de parede: contorno de toque (retângulo do vão + área de giro).
for (const T of Object.values(OBJECT_TYPES)) {
  if (!T.wall) continue;
  T.rotatable = false;
  T.outline = (o) => {
    const [d0, d1] = T.depth(o);
    const u = dirOf(o), n = mul({ x: -u.y, y: u.x }, o.inward || 1), hw = o.size.w / 2;
    const P = { x: o.x, y: o.y };
    return [[-hw, d0], [hw, d0], [hw, d1], [-hw, d1]].map(([a, b]) => add(add(P, mul(u, a)), mul(n, b)));
  };
  T.half = (o) => ({ w: o.size.w / 2, h: o.size.w / 2 });
}

export const isWallObject = (o) => !!OBJECT_TYPES[o.type]?.wall;
const dirOf = (o) => { const a = ((o.rot || 0) * Math.PI) / 180; return { x: Math.cos(a), y: Math.sin(a) }; };

// Paredes retas (sem arcos) de uma forma: [{ seg, a, b, L }]
function straightWalls(s) {
  const out = [];
  for (let i = 0, m = segmentCount(s); i < m; i++) {
    if (s.segments[i].type === 'arc') continue;
    const a = s.vertices[i], b = s.vertices[(i + 1) % s.vertices.length];
    const L = dist(a, b);
    if (L > 1e-9) out.push({ seg: i, a, b, L });
  }
  return out;
}

// Parede reta mais próxima de p (distância ≤ tol). Devolve { shape, seg, t, d }.
export function nearestWall(content, p, tol = Infinity, only = null) {
  let best = null;
  for (const s of content.shapes) {
    if (only && s.id !== only) continue;
    for (const w of straightWalls(s)) {
      const u = mul(sub(w.b, w.a), 1 / w.L);
      const t = Math.max(0, Math.min(1, dot(sub(p, w.a), u) / w.L));
      const q = add(w.a, mul(sub(w.b, w.a), t));
      const d = dist(p, q);
      if (d <= tol && (!best || d < best.d)) best = { shape: s, seg: w.seg, t, d };
    }
  }
  return best;
}

// Prende o elemento à parede (ou move ao longo dela) e atualiza x/y/rot.
export function attachToWall(content, o, hit) {
  o.host = { shapeId: hit.shape.id, seg: hit.seg, t: hit.t, nseg: segmentCount(hit.shape) };
  syncWallObject(content, o);
}

// Recalcula a posição a partir da parede. Se a forma mudou de nº de lados (dividir/mesclar),
// reencontra a parede pela última posição conhecida.
export function syncWallObject(content, o) {
  const s = o.host && content.shapes.find((x) => x.id === o.host.shapeId);
  if (!s) { o.host = null; return false; }
  const m = segmentCount(s);
  let { seg, t } = o.host;
  if (o.host.nseg !== m || seg >= m || s.segments[seg]?.type === 'arc') {
    const h = nearestWall(content, { x: o.x, y: o.y }, Infinity, s.id);
    if (!h) { o.host = null; return false; }
    seg = h.seg; t = h.t;
  }
  const a = s.vertices[seg], b = s.vertices[(seg + 1) % s.vertices.length];
  const L = dist(a, b), hw = o.size.w / 2;
  t = L > o.size.w ? Math.max(hw / L, Math.min(1 - hw / L, t)) : 0.5;
  const u = mul(sub(b, a), 1 / (L || 1));
  o.x = a.x + (b.x - a.x) * t; o.y = a.y + (b.y - a.y) * t;
  o.rot = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  // Lado de dentro da área (para onde a porta abre por padrão).
  let inward = 1;
  if (s.closed && s.vertices.length >= 3) {
    const n = { x: -u.y, y: u.x }, e = Math.max(0.05, L * 0.01);
    inward = pointInPolygon(add({ x: o.x, y: o.y }, mul(n, e)), polygonize(s)) ? 1 : -1;
  }
  o.inward = inward;
  o.host = { shapeId: s.id, seg, t, nseg: m };
  return true;
}

export function syncWallObjects(content) {
  for (const o of content.objects || []) if (isWallObject(o)) syncWallObject(content, o);
}

// Vãos nas paredes: [{ shapeId, seg, A, B }] (pontas do vão em coordenadas do mundo).
export function wallGaps(content) {
  const out = [];
  for (const o of content.objects || []) {
    if (!isWallObject(o) || !o.host) continue;
    const u = dirOf(o), hw = o.size.w / 2;
    out.push({ shapeId: o.host.shapeId, seg: o.host.seg, A: sub({ x: o.x, y: o.y }, mul(u, hw)), B: add({ x: o.x, y: o.y }, mul(u, hw)) });
  }
  return out;
}

/**
 * Símbolo de planta do elemento de parede. S: mundo → tela; k: px por metro.
 * Cores: { ink, thin, sel }.
 */
export function wallSymbolSVG(o, S, k, col) {
  const u = dirOf(o), n = mul({ x: -u.y, y: u.x }, o.inward || 1), hw = o.size.w / 2;
  const P = { x: o.x, y: o.y };
  const A = sub(P, mul(u, hw)), B = add(P, mul(u, hw));
  const sa = S(A), sb = S(B);
  const nS = n; // a escala é uniforme: mesma direção na tela
  const px = (q, d) => ({ x: q.x + nS.x * d, y: q.y + nS.y * d });
  const L = (p, q, w = 1.6, extra = '') => `<path d="M${f1(p.x)} ${f1(p.y)}L${f1(q.x)} ${f1(q.y)}" stroke="${col.ink}" stroke-width="${w}" fill="none" stroke-linecap="round" ${extra}/>`;
  const jamb = (q, d = 6) => L(px(q, -d), px(q, d), 2);
  let out = jamb(sa) + jamb(sb);
  if (o.type === 'door') {
    const sw = o.swing || 1;
    const H = o.flip ? sb : sa, J = o.flip ? sa : sb;
    const E = px(H, sw * o.size.w * k);
    const r = o.size.w * k;
    const cr = (E.x - H.x) * (J.y - H.y) - (E.y - H.y) * (J.x - H.x);
    out += L(H, E, 2.2) + `<path d="M${f1(E.x)} ${f1(E.y)}A${f1(r)} ${f1(r)} 0 0 ${cr > 0 ? 1 : 0} ${f1(J.x)} ${f1(J.y)}" stroke="${col.ink}" stroke-width="1" fill="none" stroke-dasharray="4 3"/>`;
  } else if (o.type === 'window') {
    out += L(px(sa, -4), px(sb, -4), 1.4) + L(px(sa, 4), px(sb, 4), 1.4) + L(sa, sb, 0.9);
  } else if (o.type === 'slider') {
    const ov = o.size.w * 0.06 * k;
    const ud = { x: (sb.x - sa.x) / (o.size.w * k), y: (sb.y - sa.y) / (o.size.w * k) };
    const m1 = { x: (sa.x + sb.x) / 2 + ud.x * ov, y: (sa.y + sb.y) / 2 + ud.y * ov };
    const m2 = { x: (sa.x + sb.x) / 2 - ud.x * ov, y: (sa.y + sb.y) / 2 - ud.y * ov };
    out += L(px(sa, -2.5), px(m1, -2.5), 3) + L(px(m2, 2.5), px(sb, 2.5), 3);
  } else if (o.type === 'garage') {
    const dep = o.size.w * 0.14 * k;
    const a2 = px(sa, dep), b2 = px(sb, dep);
    out += L(sa, sb, 1, 'stroke-dasharray="6 4"') + `<path d="M${f1(sa.x)} ${f1(sa.y)}L${f1(a2.x)} ${f1(a2.y)}L${f1(b2.x)} ${f1(b2.y)}L${f1(sb.x)} ${f1(sb.y)}" stroke="${col.ink}" stroke-width="1" fill="none" stroke-dasharray="6 4"/>`;
    // diagonais tracejadas: painel basculante (símbolo usual de porta de garagem)
    out += `<path d="M${f1(sa.x)} ${f1(sa.y)}L${f1(b2.x)} ${f1(b2.y)}M${f1(sb.x)} ${f1(sb.y)}L${f1(a2.x)} ${f1(a2.y)}" stroke="${col.ink}" stroke-width=".8" fill="none" stroke-dasharray="3 4" opacity=".7"/>`;
  }
  return out;
}

function rectOutline(o) {
  const a = ((o.rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const hw = o.size.w / 2, hh = o.size.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: o.x + x * c - y * s, y: o.y + x * s + y * c }));
}

export const objectType = (o) => OBJECT_TYPES[o.type];
export const objectOutline = (o) => OBJECT_TYPES[o.type].outline(o);
export const objectArea = (o) => Math.abs(signedArea(objectOutline(o)));

export function newObject(type, p, unit) {
  if (OBJECT_TYPES[type].wall) return { id: uid(), type, x: p.x, y: p.y, rot: 0, ...OBJECT_TYPES[type].defaults(unit), fill: null, showDims: true, subtract: false, host: null, inward: 1 };
  return {
    id: uid(), type, x: p.x, y: p.y, rot: 0, ...OBJECT_TYPES[type].defaults(unit),
    fill: { texture: 'concrete', pattern: null, color: null, scale: 0.5, rotation: 0, joints: false }, showDims: true, subtract: true,
  };
}

export function objectAt(content, p) {
  const list = content.objects || [];
  for (let i = list.length - 1; i >= 0; i--) if (pointInPolygon(p, objectOutline(list[i]))) return list[i];
  return null;
}

// Preenchimento em coordenadas do mundo (acima das áreas).
export function buildObjectFills(content) {
  return (content.objects || []).filter((o) => !isWallObject(o)).map((o) => {
    const poly = objectOutline(o);
    return o.fill ? renderFill(poly, o.fill, 'ob' + o.id) : `<path d="M${poly.map((q) => `${f3(q.x)} ${f3(q.y)}`).join('L')}Z" fill="#cfccc5"/>`;
  }).join('');
}

// Miniatura para a aba Objetos.
export function objectPreviewSVG(type, size = 64) {
  const o = { ...newObject(type, { x: 0, y: 0 }, 'm') };
  if (OBJECT_TYPES[type].wall) {
    const k = (size * 0.62) / o.size.w, cy = type === 'door' ? size * 0.22 : size * 0.4;
    const S = (p) => ({ x: size / 2 + p.x * k, y: cy + p.y * k });
    const a = S({ x: -o.size.w / 2, y: 0 }), b = S({ x: o.size.w / 2, y: 0 });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#f4f1ea"/>` +
      `<path d="M2 ${f1(cy)}L${f1(a.x)} ${f1(cy)}M${f1(b.x)} ${f1(cy)}L${size - 2} ${f1(cy)}" stroke="#1c2533" stroke-width="2.5"/>` +
      wallSymbolSVG(o, S, k, { ink: '#1c2533' }) + '</svg>';
  }
  const poly = objectOutline(o);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of poly) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  const pad = 0.12, w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad, m = Math.max(w, h);
  const vb = `${f3(x0 - pad - (m - w) / 2)} ${f3(y0 - pad - (m - h) / 2)} ${f3(m)} ${f3(m)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}">${renderFill(poly, o.fill, 'opv' + type)}` +
    `<path d="M${poly.map((q) => `${f3(q.x)} ${f3(q.y)}`).join('L')}Z" fill="none" stroke="#1c2533" stroke-width="${f3(m / 40)}"/></svg>`;
}
